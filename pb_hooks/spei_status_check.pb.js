/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// GET /api/spei/order/{id}/status — Check SPEI order status.
//
// Returns the current status of a SPEI order and its last CEP validation.
//
// Requires authentication.
// ─────────────────────────────────────────────────────────────────────────

routerAdd("GET", "/api/spei/order/{id}/status", (e) => {
  const orderId = e.request.pathValue("id");

  // Find the order
  var order;
  try {
    order = $app.findRecordById("spei_orders", orderId);
  } catch (_) {
    throw new NotFoundError("Order not found");
  }

  // Get last CEP verification
  var lastValidation = null;
  try {
    var verifications = $app.findRecordsByFilter(
      "cep_verifications",
      `order="${orderId}"`,
      "-created",
      1,
      0
    );
    if (verifications && verifications.length > 0) {
      var v = verifications[0];
      lastValidation = {
        status_name: v.getString("status_name"),
        status_description: v.getString("status_description"),
        validated_match: v.getBool("validated_match"),
        mismatch_reason: v.getString("mismatch_reason"),
        created: v.getString("created"),
      };
    }
  } catch (_) {}

  return e.json(200, {
    order_id: orderId,
    status: order.getString("status"),
    amount: order.get("amount"),
    currency: order.getString("currency"),
    submitted_at: order.getString("submitted_at"),
    validated_at: order.getString("validated_at"),
    retry_count: order.getInt("retry_count") || 0,
    last_validation: lastValidation,
    created: order.getString("created"),
  });
});
