/// <reference path="../pb_data/types.d.ts" />
// Clip does not expose a verifiable HMAC signature on public webhooks.
// Security strategy: the webhook only triggers a re-query of the real
// payment state via GET /v2/checkout/{id}; we never trust the payload alone.

routerAdd("POST", "/api/clip/webhook", (e) => {
  const clip = require(`${__hooks}/clip_api_client.js`);

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
    clipPayment = clip.request("GET", "/v2/checkout/" + paymentRequestId, null, 15);
  } catch (err) {
    $app.logger().error("Clip webhook: error querying Clip API", "error", err.message);
    // Throw a real HTTP 502 so Clip retries the webhook delivery.
    throw new ApiError(502, "Could not verify payment with Clip API. Retry later.");
  }

  // v2 uses "status" field (not "resource_status"), amount is top-level.
  const resourceStatus = clipPayment["status"] || clipPayment["resource_status"];
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
 * Maps a raw Clip v2 status value to one of the allowed DB select values.
 * Unknown or unexpected values are stored as PENDING so no DB save is rejected.
 *
 * Clip v2 documented statuses:
 *   CHECKOUT_CREATED    → CREATED
 *   CHECKOUT_PENDING    → PENDING
 *   CHECKOUT_COMPLETED  → COMPLETED
 *   CHECKOUT_CANCELED   → CANCELED
 *   CHECKOUT_EXPIRED    → EXPIRED
 *
 * @param {string} raw
 * @returns {"CREATED"|"PENDING"|"COMPLETED"|"CANCELED"|"EXPIRED"}
 */
function normaliseClipStatus(raw) {
  const ALLOWED = {
    // v2 prefixed statuses
    CHECKOUT_CREATED:   "CREATED",
    CHECKOUT_PENDING:   "PENDING",
    CHECKOUT_COMPLETED: "COMPLETED",
    CHECKOUT_CANCELED:  "CANCELED",
    CHECKOUT_CANCELLED: "CANCELED",
    CHECKOUT_EXPIRED:   "EXPIRED",
    // v1 / legacy statuses (kept for backwards compatibility)
    CREATED:   "CREATED",
    PENDING:   "PENDING",
    COMPLETED: "COMPLETED",
    CANCELED:  "CANCELED",
    CANCELLED: "CANCELED",
    EXPIRED:   "EXPIRED",
  };

  const upper = (raw || "").toString().toUpperCase().trim();
  const mapped = ALLOWED[upper];

  if (!mapped) {
    $app.logger().warn(
      "Clip webhook: unknown status received, defaulting to PENDING",
      "raw_status", raw
    );
    return "PENDING";
  }

  return mapped;
}
