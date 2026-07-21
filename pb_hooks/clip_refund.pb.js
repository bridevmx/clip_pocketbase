/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// POST /api/clip/refund — Refund a completed order (full or partial).
//
// Requires superuser authentication.
//
// Request body:
//   order_id  (required) — The clip_orders record ID
//   amount    (optional) — Amount to refund in MXN (omit for full refund)
//   reason    (optional) — Reason for the refund
//
// Response (success):
//   { success, refund_id, receipt_no, status, amount_refunded }
//
// Response (error):
//   { success, error, message }
// ─────────────────────────────────────────────────────────────────────────

routerAdd("POST", "/api/clip/refund", (e) => {
  const clip = require(`${__hooks}/clip_api_client.js`);
  const info = e.requestInfo();
  const body = info.body;

  // Requires superuser auth
  // PocketBase doesn't expose isSuperUser on info.auth, so we verify
  // the authenticated user exists in the _superusers collection.
  if (!info.auth || !info.auth.id) {
    throw new ForbiddenError("Authentication required");
  }
  try {
    $app.findRecordById("_superusers", info.auth.id);
  } catch (_) {
    throw new ForbiddenError("Superuser authentication required");
  }

  const orderId = body["order_id"];
  const amount = body["amount"] || null;
  const reason = body["reason"] || "";

  if (!orderId) {
    throw new BadRequestError("order_id is required");
  }

  // Find the order
  var order;
  try {
    order = $app.findRecordById("clip_orders", orderId);
  } catch (_) {
    throw new NotFoundError("Order not found");
  }

  // Validate order status
  var status = order.getString("status");
  if (status !== "COMPLETED") {
    throw new BadRequestError("Order must be COMPLETED to refund");
  }

  // Check existing refunds
  var existingRefundAmount = order.get("refund_amount") || 0;
  var originalAmount = order.get("amount_paid") || order.get("amount");
  if (existingRefundAmount >= originalAmount) {
    throw new BadRequestError("Order has already been fully refunded");
  }

  if (amount && (existingRefundAmount + amount) > originalAmount) {
    throw new BadRequestError("Refund amount exceeds original payment");
  }

  var receiptNo = order.getString("receipt_no");
  if (!receiptNo) {
    throw new BadRequestError("Order has no receipt number to refund");
  }

  // Call Clip API
  var clipResult;
  try {
    clipResult = clip.refund(receiptNo, orderId, amount, reason);
  } catch (err) {
    $app.logger().error("[CLIP REFUND] API call failed", "error", err.message);
    throw new InternalServerError("Could not process refund");
  }

  if (clipResult.statusCode < 200 || clipResult.statusCode > 299) {
    var errData = clipResult.data || {};
    var errorMsg = errData.message || errData.error || "Unknown Clip error";

    $app.logger().error("[CLIP REFUND] Clip API rejected refund",
      "status", clipResult.statusCode,
      "error", errorMsg
    );

    throw new BadRequestError("Refund rejected: " + errorMsg);
  }

  // Update order with refund info
  var refundData = clipResult.data;
  $app.runInTransaction((txApp) => {
    order.set("refund_id", refundData.id || refundData.receipt_no);
    order.set("refund_status", "APPROVED");
    order.set("refund_amount", amount || originalAmount);
    order.set("refunded_at", new Date().toISOString());
    txApp.save(order);
  });

  $app.logger().info("[CLIP REFUND] Refund approved",
    "order_id", orderId,
    "receipt_no", receiptNo,
    "amount_refunded", amount || originalAmount
  );

  return e.json(200, {
    success: true,
    refund_id: refundData.id || refundData.receipt_no,
    receipt_no: refundData.receipt_no,
    status: "APPROVED",
    amount_refunded: amount || originalAmount,
  });
});
