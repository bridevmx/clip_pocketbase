/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// GET /api/spei/order/{id}/status — Returns current SPEI order status.
//
// Returns: status, amount, bank details (CLABE, bank_name, account_holder)
// and the last CEP verification record.
//
// Authentication: REQUIRED
// Access control (via plugin_settings_helper):
//   - Plugin admins can view any order.
//   - Regular users can only view orders linked to their account.
//   - Orders created by guests are admin-only.
// ─────────────────────────────────────────────────────────────────────────

routerAdd("GET", "/api/spei/order/{id}/status", (e) => {
  const psh     = require(`${__hooks}/plugin_settings_helper.js`);
  const orderId = e.request.pathValue("id");

  // Require authentication
  const info = e.requestInfo();
  if (!info.auth || !info.auth.id) {
    throw new UnauthorizedError("Authentication required");
  }

  // Find the order
  var order;
  try {
    order = $app.findRecordById("spei_orders", orderId);
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

  // Get spei_settings bank info securely from backend
  var bankInfo = null;
  var speiSettingsId = order.getString("spei_settings");
  if (speiSettingsId) {
    try {
      var speiSettings = $app.findRecordById("spei_settings", speiSettingsId);
      bankInfo = {
        id: speiSettings.id,
        clabe: speiSettings.getString("clabe"),
        bank_name: speiSettings.getString("bank_name"),
        account_holder: speiSettings.getString("account_holder")
      };
    } catch (_) {}
  }

  // Get last CEP verification using secure bind parameter
  var lastValidation = null;
  try {
    var verifications = $app.findRecordsByFilter(
      "cep_verifications",
      "order = {:orderId}",
      "-created",
      1,
      0,
      { orderId: orderId }
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
    spei_settings: bankInfo,
    last_validation: lastValidation,
    created: order.getString("created"),
  });
});
