/// <reference path="../pb_data/types.d.ts" />
// Clip no expone firma HMAC verificable en el webhook público.
// Estrategia de seguridad: el webhook solo dispara una re-consulta del
// estado real vía GET /checkout/{id}; nunca confiamos en el payload solo.

function consultarPagoClip(paymentRequestId) {
  const apiKey = $os.getenv("CLIP_API_KEY");
  if (!apiKey) throw new Error("CLIP_API_KEY no configurada");

  const credentials = btoa(`${apiKey}:`);
  const res = $http.send({
    method: "GET",
    url: `https://api.payclip.com/v1/checkout/${paymentRequestId}`,
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
    timeout: 15,
  });

  if (res.statusCode !== 200) {
    throw new Error(`Clip API error ${res.statusCode}: ${res.raw}`);
  }
  return res.json;
}

routerAdd("POST", "/api/clip/webhook", (e) => {
  const body = e.requestInfo().body;

  if (!body || !body["id"] || !body["origin"] || !body["event_type"]) {
    $app.logger().error("Clip webhook: payload inválido", "body", JSON.stringify(body));
    throw new BadRequestError("Payload inválido");
  }

  const paymentRequestId = body["id"];
  const origin = body["origin"];

  $app.logger().info("Clip webhook recibido", "id", paymentRequestId, "origin", origin);

  if (origin !== "checkout-api") {
    return e.json(200, { status: "ignored" });
  }

  let clipPayment;
  try {
    clipPayment = consultarPagoClip(paymentRequestId);
  } catch (err) {
    $app.logger().error("Clip webhook: error consultando API", "error", err.message);
    return e.json(200, { status: "error_consultando_api" });
  }

  const resourceStatus = clipPayment["resource_status"];
  const receiptNo = clipPayment["receipt_no"] || null;
  const amountPaid = clipPayment["amount"] || 0;

  let orders;
  try {
    orders = $app.findRecordsByFilter(
      "clip_orders",
      `clip_payment_request_id="${paymentRequestId}"`,
      "-created", 1, 0
    );
  } catch (err) {
    return e.json(200, { status: "orden_no_encontrada" });
  }

  if (!orders || orders.length === 0) {
    return e.json(200, { status: "sin_orden" });
  }

  const order = orders[0];
  if (order.getString("status") === "COMPLETED") {
    return e.json(200, { status: "ya_procesada" });
  }

  $app.runInTransaction((txApp) => {
    order.set("status", resourceStatus);
    order.set("clip_raw_status", resourceStatus);

    if (resourceStatus === "COMPLETED") {
      order.set("paid_at", new Date().toISOString());
      order.set("receipt_no", receiptNo);
      order.set("amount_paid", amountPaid);
    } else if (resourceStatus === "CANCELED" || resourceStatus === "EXPIRED") {
      order.set("canceled_at", new Date().toISOString());
    }
    txApp.save(order);

    const paymentsCollection = txApp.findCollectionByNameOrId("clip_payments");
    const log = new Record(paymentsCollection);
    log.set("order", order.id);
    log.set("raw_webhook_payload", body);
    log.set("raw_api_response", clipPayment);
    log.set("received_at", new Date().toISOString());
    txApp.save(log);
  });

  return e.json(200, { status: "ok", processed_status: resourceStatus });
});
