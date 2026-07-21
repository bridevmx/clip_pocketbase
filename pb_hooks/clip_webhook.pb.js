/// <reference path="../pb_data/types.d.ts" />
// Clip v2 Checkout Webhook handler.
//
// Clip sends a minimal notification payload — the plugin re-queries the
// Clip API for the real payment state before updating any record.
// We never trust the webhook payload alone.
//
// Clip v2 webhook payload shape:
//   {
//     "id": "<webhook-event-uuid>",
//     "api_version": "1.0",
//     "payment_request_id": "<clip-payment-uuid>",
//     "transaction_id": "<clip-transaction-uuid>",
//     "resource": "CHECKOUT",
//     "resource_status": "CREATED" | "PENDING" | "COMPLETED" | "CANCELED" | "EXPIRED",
//     "detail_type": "...",
//     "attempts": 1,
//     "sent_date": "...",
//     "created_at": "..."
//   }

routerAdd("POST", "/api/clip/webhook", (e) => {
  const clip = require(`${__hooks}/clip_api_client.js`);

  const body = e.requestInfo().body;

  // Require at minimum a payment_request_id to proceed.
  // Accept both v2 format (payment_request_id) and legacy format (id + origin).
  const paymentRequestId = body["payment_request_id"] || body["id"];

  if (!paymentRequestId) {
    $app.logger().error("Clip webhook: missing payment_request_id", "body", JSON.stringify(body));
    throw new BadRequestError("Invalid payload: missing payment_request_id");
  }

  // Legacy format filter: if the payload has origin field and it's not a
  // recognised source, ignore it silently.
  const origin = body["origin"];
  if (origin && origin !== "checkout-api" && origin !== "payments-api") {
    $app.logger().info("Clip webhook: ignored unknown origin", "origin", origin);
    return e.json(200, { status: "ignored" });
  }

  $app.logger().info("Clip webhook received", "payment_request_id", paymentRequestId);

  // Query real payment state from Clip API (single source of truth).
  let clipResult;
  try {
    clipResult = clip.request("GET", "/v2/checkout/" + paymentRequestId, null, 15);
  } catch (err) {
    $app.logger().error("Clip webhook: network error querying Clip API", "error", err.message);
    // Throw HTTP 502 so Clip retries webhook delivery automatically.
    throw new ApiError(502, "Could not verify payment with Clip API. Retry later.");
  }

  // 404 — valid UUID but Clip doesn't know it. Nothing to do.
  if (clipResult.statusCode === 404) {
    $app.logger().warn("Clip webhook: payment_request_id not found in Clip", "id", paymentRequestId);
    return e.json(200, { status: "clip_not_found" });
  }

  // 400 — malformed UUID or format error. Log and return 200 (don't retry).
  if (clipResult.statusCode === 400) {
    const errBody = clipResult.data || {};
    $app.logger().error(
      "Clip webhook: format error querying Clip API",
      "id", paymentRequestId,
      "code_message", errBody["code_message"] || "",
      "detail", errBody["detail"] || ""
    );
    return e.json(200, { status: "clip_format_error" });
  }

  // Any other non-2xx → 502 to trigger Clip retry.
  if (clipResult.statusCode < 200 || clipResult.statusCode > 299) {
    $app.logger().error(
      "Clip webhook: unexpected status from Clip API",
      "status", clipResult.statusCode,
      "body", JSON.stringify(clipResult.data)
    );
    throw new ApiError(502, "Unexpected Clip API response. Retry later.");
  }

  const clipPayment = clipResult.data;

  // v2 GET /checkout/{id} returns "status" at top level.
  const resourceStatus = clipPayment["status"] || clipPayment["resource_status"];
  const receiptNo      = clipPayment["receipt_no"] || null;
  const amountPaid     = clipPayment["amount"] || 0;

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
 * Maps a raw Clip v2 status to one of the allowed DB select values.
 *
 * v2 GET /checkout/{id} returns status with CHECKOUT_ prefix:
 *   CHECKOUT_CREATED    → CREATED
 *   CHECKOUT_PENDING    → PENDING
 *   CHECKOUT_COMPLETED  → COMPLETED
 *   CHECKOUT_CANCELED   → CANCELED
 *   CHECKOUT_EXPIRED    → EXPIRED
 *
 * v1 / webhook resource_status values kept for compatibility:
 *   CREATED / PENDING / COMPLETED / CANCELED / EXPIRED
 *
 * @param {string} raw
 * @returns {"CREATED"|"PENDING"|"COMPLETED"|"CANCELED"|"EXPIRED"}
 */
function normaliseClipStatus(raw) {
  const ALLOWED = {
    CHECKOUT_CREATED:   "CREATED",
    CHECKOUT_PENDING:   "PENDING",
    CHECKOUT_COMPLETED: "COMPLETED",
    CHECKOUT_CANCELED:  "CANCELED",
    CHECKOUT_CANCELLED: "CANCELED",
    CHECKOUT_EXPIRED:   "EXPIRED",
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
