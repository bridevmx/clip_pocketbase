/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// Migration: Seed setup wizard settings in plugin_settings
// ─────────────────────────────────────────────────────────────────────────

migrate((app) => {
    const defaults = [
        {
            key: "is_configured",
            value: "false",
            description: "Set to true when setup wizard is completed",
        },
        {
            key: "clip_api_key",
            value: "",
            description: "Clip API key (Basic <base64token> or base64 token)",
        },
        {
            key: "pocketbase_url",
            value: "",
            description: "Public URL of PocketBase instance",
        },
    ];

    var col;
    try {
        col = app.findCollectionByNameOrId("plugin_settings");
    } catch (_) {
        return;
    }

    for (var i = 0; i < defaults.length; i++) {
        var d = defaults[i];
        try {
            app.findFirstRecordByFilter("plugin_settings", "key = {:key}", { key: d.key });
        } catch (_) {
            var record = new Record(col);
            record.set("key", d.key);
            record.set("value", d.value);
            record.set("description", d.description);
            app.save(record);
        }
    }
}, (app) => {
    const keys = ["is_configured", "clip_api_key", "pocketbase_url"];
    for (var i = 0; i < keys.length; i++) {
        try {
            var rec = app.findFirstRecordByFilter("plugin_settings", "key = {:key}", { key: keys[i] });
            if (rec) {
                app.delete(rec);
            }
        } catch (_) {}
    }
});
