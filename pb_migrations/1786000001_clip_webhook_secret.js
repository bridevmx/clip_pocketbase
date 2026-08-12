/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// Migration: Seed clip_webhook_secret in plugin_settings
// ─────────────────────────────────────────────────────────────────────────

migrate((app) => {
    try {
        app.findFirstRecordByFilter("plugin_settings", "key = {:key}", { key: "clip_webhook_secret" });
        return;
    } catch (_) {}

    const col = app.findCollectionByNameOrId("plugin_settings");
    const record = new Record(col);
    record.set("key", "clip_webhook_secret");
    record.set("value", "");
    record.set("description", "Secret token appended to Clip webhook URL as ?token=VALUE. Set this to a random string (UUID) and configure the same value in your Clip dashboard webhook URL. Leave empty to disable (not recommended for production).");
    app.save(record);
}, (app) => {
    try {
        const record = app.findFirstRecordByFilter("plugin_settings", "key = {:key}", { key: "clip_webhook_secret" });
        if (record) {
            app.delete(record);
        }
    } catch (_) {}
});
