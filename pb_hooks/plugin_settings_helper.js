/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// Plugin Settings Helper — CommonJS module, shared via require().
//
// Provides centralized access control for the CLIP + SPEI plugin.
// Instead of hardcoding _superusers, any project configures its own
// admin users via the plugin_settings collection in the PocketBase admin UI.
//
// Usage in any pb_hooks/*.pb.js file:
//   const psh = require(`${__hooks}/plugin_settings_helper.js`);
//
//   // Check if a user has plugin admin rights
//   if (!psh.isPluginAdmin(info.auth.id)) throw new ForbiddenError("...");
//
//   // Read a config value
//   const field = psh.getSetting("clip_amount_field", "total");
//
// ─── plugin_settings keys used by the plugin ──────────────────────────────
//   admin_user_ids     — comma-separated user IDs with plugin admin rights.
//                        These users can access: refund, transactions,
//                        validate-cep, and force status re-check.
//                        Superusers (_superusers) always have access.
//
//   clip_amount_field  — field name in the reference collection that holds
//                        the canonical order price (e.g. "total", "price").
//                        When set, clip_create_link reads the amount from
//                        the DB instead of trusting the client (SECURE MODE).
//                        Leave empty to keep backward-compatible client mode.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Reads a value from the plugin_settings collection.
 * Returns defaultValue if the key is not found or the collection doesn't exist.
 *
 * @param {string} key
 * @param {string} [defaultValue=""]
 * @returns {string}
 */
function getSetting(key, defaultValue) {
    try {
        var rec = $app.findFirstRecordByFilter(
            "plugin_settings",
            "key = {:key}",
            { key: key }
        );
        if (rec) {
            var val = rec.getString("value");
            return val !== "" ? val : (defaultValue !== undefined ? defaultValue : "");
        }
    } catch (_) {}
    return defaultValue !== undefined ? defaultValue : "";
}

/**
 * Returns true if the userId has plugin admin rights, meaning:
 *   1. The user is a _superuser (always has access), OR
 *   2. Their ID appears in plugin_settings key "admin_user_ids"
 *
 * @param {string} userId
 * @returns {boolean}
 */
function isPluginAdmin(userId) {
    if (!userId) return false;

    // Superusers always have admin access
    try {
        $app.findRecordById("_superusers", userId);
        return true;
    } catch (_) {}

    // Check the configured admin_user_ids list
    var adminIds = getSetting("admin_user_ids", "");
    if (!adminIds) return false;

    var ids = adminIds.split(",");
    for (var i = 0; i < ids.length; i++) {
        if (ids[i].trim() === userId) return true;
    }
    return false;
}

module.exports = {
    getSetting:    getSetting,
    isPluginAdmin: isPluginAdmin,
};
