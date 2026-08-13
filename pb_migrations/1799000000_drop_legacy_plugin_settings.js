/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// Migration: Drop legacy plugin_settings collection
//
// All plugin configurations (encrypted credentials, settings, admin user IDs)
// are now unified into z_system_settings_do_not_touch.
// ─────────────────────────────────────────────────────────────────────────

migrate((app) => {
    try {
        const col = app.findCollectionByNameOrId("plugin_settings");
        if (col) {
            app.delete(col);
            console.log("[MIGRATION] Legacy plugin_settings collection dropped successfully.");
        }
    } catch (_) {}
}, (app) => {
    // Re-creation on rollback not required
});
