/// <reference path="../pb_data/types.d.ts" />
// Clip v2 Checkout Webhook handler.
//
// Clip sends a minimal notification payload — the plugin re-queries the
// Clip API for the real payment state before updating any record.
// We never trust the webhook payload alone.

routerAdd("POST", "/api/clip/webhook", (e) => {
  const clip = require(`${__hooks}/clip_api_client.js`);

  const body = e.requestInfo().body;

  const paymentRequestId = body["payment_request_id"] || body["id"];

  if (!paymentRequestId) {
    $app.logger().error("Clip webhook: missing payment_request_id", "body", JSON.stringify(body));
    throw new BadRequestError("Invalid payload: missing payment_request_id");
  }

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
    throw new ApiError(502, "Could not verify payment with Clip API. Retry later.");
  }

  if (clipResult.statusCode === 404) {
    $app.logger().warn("Clip webhook: payment_request_id not found in Clip", "id", paymentRequestId);
    return e.json(200, { status: "clip_not_found" });
  }

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

  if (clipResult.statusCode < 200 || clipResult.statusCode > 299) {
    throw new ApiError(502, "Unexpected Clip API response. Retry later.");
  }

  const clipPayment = clipResult.data;
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
  const currentStatus = order.getString("status");
  const normalisedStatus = normaliseClipStatus(resourceStatus);

  // Idempotency: skip if the order is already in its final state (COMPLETED, CANCELED, EXPIRED)
  // or if the status hasn't changed.
  if (currentStatus === "COMPLETED" || currentStatus === "CANCELED" || currentStatus === "EXPIRED" || currentStatus === normalisedStatus) {
    return e.json(200, { status: "already_processed", processed_status: currentStatus });
  }

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

    // Audit log: record the webhook event.
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
