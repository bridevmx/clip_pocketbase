/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// GET /api/clip/order/{id}/status — Re-queries Clip API for the live payment state.
//
// Use when webhooks are missed (e.g. server hibernation). Queries Clip
// directly and updates the local clip_order if the status changed.
//
// Authentication: REQUIRED
// Access control:
//   - Plugin admins (superusers or users listed in plugin_settings
//     "admin_user_ids") can query any order.
//   - Regular users can only query orders linked to their own account.
//   - Orders created by guests (no `user` field) are admin-only.
// ─────────────────────────────────────────────────────────────────────────

routerAdd("GET", "/api/clip/order/{id}/status", (e) => {
  const clip = require(`${__hooks}/clip_api_client.js`);
  const psh  = require(`${__hooks}/plugin_settings_helper.js`);
  const orderId = e.request.params.id;

  // Require authentication (documented in header but previously missing)
  const info = e.requestInfo();
  if (!info.auth || !info.auth.id) {
    throw new UnauthorizedError("Authentication required");
  }

  // Find the order
  var order;
  try {
    order = $app.findRecordById("clip_orders", orderId);
  } catch (_) {
    throw new NotFoundError("Order not found");
  }

  // Allow: plugin admin OR the user who created the order
  const isAdmin   = psh.isPluginAdmin(info.auth.id);
  const ownerUser = order.getString("user");
  const isOwner   = ownerUser && ownerUser === info.auth.id;
  if (!isAdmin && !isOwner) {
    throw new ForbiddenError("Not authorized to view this order");
  }

  var paymentRequestId = order.getString("clip_payment_request_id");
  if (!paymentRequestId) {
    throw new BadRequestError("Order has no Clip payment_request_id");
  }

  // Call Clip API to get current status
  var result;
  try {
    result = clip.request("GET", "/v2/checkout/" + paymentRequestId, null, 15);
  } catch (err) {
    $app.logger().error("[CLIP STATUS] API call failed", "error", err.message);
    throw new InternalServerError("Could not check status");
  }

  if (result.statusCode === 404) {
    throw new NotFoundError("Payment not found in Clip");
  }

  if (result.statusCode < 200 || result.statusCode > 299) {
    throw new InternalServerError("Clip API error");
  }

  var clipData = result.data;
  var rawStatus = clipData.status || "";
  var normalisedStatus = clip.normaliseClipStatus(rawStatus);

  // Update order if status changed
  var currentStatus = order.getString("status");
  if (normalisedStatus !== currentStatus) {
    $app.runInTransaction((txApp) => {
      order.set("status", normalisedStatus);
      order.set("clip_raw_status", rawStatus);

      if (normalisedStatus === "COMPLETED") {
        order.set("receipt_no", clipData.receipt_no || "");
        order.set("amount_paid", clipData.amount || 0);
        order.set("paid_at", clipData.modified_at || new Date().toISOString());
      }

      if (normalisedStatus === "CANCELED" || normalisedStatus === "EXPIRED") {
        order.set("canceled_at", clipData.modified_at || new Date().toISOString());
      }

      txApp.save(order);
    });

    $app.logger().info("[CLIP STATUS] Order status updated",
      "order_id", orderId,
      "old_status", currentStatus,
      "new_status", normalisedStatus
    );
  }

  // Update last_status_check
  order.set("last_status_check", new Date().toISOString());
  $app.save(order);

  return e.json(200, {
    order_id: orderId,
    clip_status: normalisedStatus,
    receipt_no: clipData.receipt_no || order.getString("receipt_no"),
    amount_paid: clipData.amount || order.get("amount_paid"),
    last_checked: new Date().toISOString(),
  });
});
