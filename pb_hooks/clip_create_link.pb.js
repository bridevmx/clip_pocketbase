/// <reference path="../pb_data/types.d.ts" />
routerAdd("POST", "/api/clip/create-link", (e) => {
  const info = e.requestInfo();
  if (!info.auth) throw new UnauthorizedError("Se requiere autenticación");

  const body = info.body;
  const amount = body["amount"];
  const referenceCollection = body["reference_collection"];
  const referenceId = body["reference_id"];
  const userId = info.auth.id;

  if (!amount || !referenceCollection || !referenceId) {
    throw new BadRequestError("amount, reference_collection y reference_id son requeridos");
  }
  if (amount <= 0 || amount > 99999) {
    throw new BadRequestError("Monto inválido");
  }

  const apiKey = $os.getenv("CLIP_API_KEY");
  const webhookBaseUrl = $os.getenv("POCKETBASE_URL");

  let order;
  $app.runInTransaction((txApp) => {
    const ordersCollection = txApp.findCollectionByNameOrId("clip_orders");
    order = new Record(ordersCollection);
    order.set("user", userId);
    order.set("reference_collection", referenceCollection);
    order.set("reference_id", referenceId);
    order.set("amount", amount);
    order.set("currency", "MXN");
    order.set("status", "PENDING_LINK");
    txApp.save(order);
  });

  const credentials = btoa(`${apiKey}:`);
  const clipRes = $http.send({
    method: "POST",
    url: "https://api.payclip.com/v1/checkout",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: amount,
      currency: "MXN",
      webhook_url: `${webhookBaseUrl}/api/clip/webhook`,
      metadata: { order_id: order.id, user_id: userId },
    }),
    timeout: 20,
  });

  if (clipRes.statusCode !== 200 && clipRes.statusCode !== 201) {
    $app.logger().error("Error creando link en Clip API", "status", clipRes.statusCode, "response", clipRes.raw);
    order.set("status", "ERROR_CLIP");
    $app.save(order);
    throw new Error(`Error de Clip: ${clipRes.statusCode}`);
  }

  const clipData = clipRes.json;
  order.set("clip_payment_request_id", clipData["payment_request_id"]);
  order.set("clip_payment_url", clipData["payment_url"]);
  order.set("status", "CREATED");
  $app.save(order);

  return e.json(200, {
    order_id: order.id,
    payment_url: clipData["payment_url"],
    payment_request_id: clipData["payment_request_id"],
    status: "CREATED",
  });
});
