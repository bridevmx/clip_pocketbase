/// <reference path="../pb_data/types.d.ts" />
// Clip does not expose a verifiable HMAC signature on public webhooks.
// Security strategy: the webhook only triggers a re-query of the real
// payment state via GET /checkout/{id}; we never trust the payload alone.
//
// Depends on: clip_api_client.pb.js (loaded automatically by PocketBase).

routerAdd("POST", "/api/clip/webhook", (e) => {
  const body = e.requestInfo().body;

  if (!body || !body["id"] || !body["origin"] || !body["event_type"]) {
    $app.logger().error("Clip webhook: invalid payload", "body", JSON.stringify(body));
    throw new BadRequestError("Invalid payload");
  }

  const paymentRequestId = body["id"];
  const origin = body["origin"];

  $app.logger().info("Clip webhook received", "id", paymentRequestId, "origin", origin);

  if (origin !== "checkout-api") {
    return e.json(200, { status: "ignored" });
  }

  // Query real payment state from Clip API (single source of truth).
  let clipPayment;
  try {
    clipPayment = clipApiRequest("GET", "/v1/checkout/" + paymentRequestId, null, 15);
  } catch (err) {
    $app.logger().error("Clip webhook: error querying Clip API", "error", err.message);
    // Return 502 so Clip retries the webhook delivery.
    return e.json(502, { status: "upstream_error" });
  }

  const resourceStatus = clipPayment["resource_status"];
  const receiptNo = clipPayment["receipt_no"] || null;
  const amountPaid = clipPayment["amount"] || 0;

  // Find the matching clip_order by payment_request_id.
  let orders;
  try {
    orders = $app.findRecordsByFilter(
      "clip_orders",
      `clip_payment_request_id="${paymentRequestId}"`,
      "-created", 1, 0
    );
  } catch (err) {
    $app.logger().warn("Clip webhook: order not found", "payment_id", paymentRequestId);
    return e.json(200, { status: "order_not_found" });
  }

  if (!orders || orders.length === 0) {
    return e.json(200, { status: "order_not_found" });
  }

  const order = orders[0];

  // Idempotency guard: skip already-completed orders.
  if (order.getString("status") === "COMPLETED") {
    return e.json(200, { status: "already_processed" });
  }

  // Normalise the status value from Clip to a value accepted by the DB schema.
  const normalisedStatus = normaliseClipStatus(resourceStatus);

  $app.runInTransaction((txApp) => {
    order.set("status", normalisedStatus);
    order.set("clip_raw_status", resourceStatus);

    if (normalisedStatus === "COMPLETED") {
      order.set("paid_at", new Date().toISOString());
      order.set("receipt_no", receiptNo);
      order.set("amount_paid", amountPaid);
    } else if (normalisedStatus === "CANCELED" || normalisedStatus === "EXPIRED") {
      order.set("canceled_at", new Date().toISOString());
    }
    txApp.save(order);

    // Audit log: always record the raw webhook and API response.
    const paymentsCollection = txApp.findCollectionByNameOrId("clip_payments");
    const log = new Record(paymentsCollection);
    log.set("order", order.id);
    log.set("raw_webhook_payload", body);
    log.set("raw_api_response", clipPayment);
    log.set("received_at", new Date().toISOString());
    txApp.save(log);
  });

  return e.json(200, { status: "ok", processed_status: normalisedStatus });
});

/**
 * Maps a raw Clip resource_status value to one of the allowed DB select values.
 * Unknown or unexpected values are stored as PENDING so no DB save is rejected.
 *
 * Clip documented statuses (case-insensitive): CREATED, PENDING, COMPLETED, CANCELED, EXPIRED.
 *
 * @param {string} raw
 * @returns {"CREATED"|"PENDING"|"COMPLETED"|"CANCELED"|"EXPIRED"}
 */
function normaliseClipStatus(raw) {
  const ALLOWED = {
    CREATED: "CREATED",
    PENDING: "PENDING",
    COMPLETED: "COMPLETED",
    CANCELED: "CANCELED",
    CANCELLED: "CANCELED", // tolerate British spelling variant
    EXPIRED: "EXPIRED",
  };

  const upper = (raw || "").toString().toUpperCase().trim();
  const mapped = ALLOWED[upper];

  if (!mapped) {
    $app.logger().warn(
      "Clip webhook: unknown resource_status received, defaulting to PENDING",
      "raw_status", raw
    );
    return "PENDING";
  }

  return mapped;
}
