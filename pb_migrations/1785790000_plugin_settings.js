/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// Migration: Create plugin_settings collection
//
// This collection centralizes authorization and configuration for the
// CLIP + SPEI plugin. It replaces hardcoded _superusers checks and
// allows any project to define its own admin users and plugin config
// without touching source code.
//
// All CRUD is locked to the API (only accessible from server-side code
// or the PocketBase admin UI). No client can read or write this table.
//
// Keys seeded:
//   admin_user_ids    — comma-separated IDs of plugin admin users
//   clip_amount_field — field in reference collection holding the price
// ─────────────────────────────────────────────────────────────────────────

migrate((app) => {
    // Idempotent: skip if already exists
    try {
        app.findCollectionByNameOrId("plugin_settings");
        return;
    } catch (_) {}

    const col = new Collection({
        id:         "coll_pluginsett",
        name:       "plugin_settings",
        type:       "base",
        // Fully locked from REST API — only readable/writable via server-side code
        // or the PocketBase admin UI (superuser session).
        listRule:   null,
        viewRule:   null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
            { name: "created",     type: "autodate", onCreate: true },
            { name: "updated",     type: "autodate", onCreate: true, onUpdate: true },
            { name: "key",         type: "text", required: true },
            { name: "value",       type: "text" },
            { name: "description", type: "text" },
        ],
        indexes: [
            "CREATE UNIQUE INDEX `idx_plugin_settings_key` ON `plugin_settings` (`key`)"
        ],
    });
    app.save(col);

    // Seed default (empty) settings so they appear in the admin UI
    const defaults = [
        {
            key: "admin_user_ids",
            value: "",
            description: "Comma-separated list of user IDs that have plugin admin privileges. These users can access the refund, transactions, force validate-cep and order status endpoints. Superusers (_superusers collection) always have access regardless of this setting. Example: abc123xyz,def456uvw",
        },
        {
            key: "clip_amount_field",
            value: "",
            description: "Field name in the reference collection that holds the canonical order price. When set, clip_create_link reads the amount from the DB instead of trusting the client value (SECURE MODE). Leave empty to keep backward-compatible mode where the client provides the amount. Example values: total, price, amount, order_total",
        },
    ];

    for (var i = 0; i < defaults.length; i++) {
        var d = defaults[i];
        var rec = new Record(col);
        rec.set("key",         d.key);
        rec.set("value",       d.value);
        rec.set("description", d.description);
        app.save(rec);
    }

}, (app) => {
    try {
        const col = app.findCollectionByNameOrId("plugin_settings");
        app.delete(col);
    } catch (_) {}
});
