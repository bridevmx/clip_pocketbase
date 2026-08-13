/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// Migration: Create z_system_* collections for pb-core infrastructure
//
// Creates:
//   1. z_system_settings_do_not_touch
//   2. z_system_hooks_do_not_touch
//   3. z_system_migrations_do_not_touch
// ─────────────────────────────────────────────────────────────────────────

migrate((app) => {
    // 1. z_system_settings_do_not_touch
    try {
        app.findCollectionByNameOrId("z_system_settings_do_not_touch");
    } catch (_) {
        const colSettings = new Collection({
            name: "z_system_settings_do_not_touch",
            type: "base",
            listRule: null,
            viewRule: null,
            createRule: null,
            updateRule: null,
            deleteRule: null,
            fields: [
                { name: "created", type: "autodate", onCreate: true },
                { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
                { name: "key", type: "text", required: true },
                { name: "value", type: "text" },
                { name: "is_encrypted", type: "bool" }
            ],
            indexes: [
                "CREATE UNIQUE INDEX `idx_z_system_settings_key` ON `z_system_settings_do_not_touch` (`key`)"
            ]
        });
        app.save(colSettings);
    }

    // 2. z_system_hooks_do_not_touch
    try {
        app.findCollectionByNameOrId("z_system_hooks_do_not_touch");
    } catch (_) {
        const colHooks = new Collection({
            name: "z_system_hooks_do_not_touch",
            type: "base",
            listRule: null,
            viewRule: null,
            createRule: null,
            updateRule: null,
            deleteRule: null,
            fields: [
                { name: "created", type: "autodate", onCreate: true },
                { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
                { name: "filename", type: "text", required: true },
                { name: "content", type: "editor", required: true },
                { name: "active", type: "bool" }
            ],
            indexes: [
                "CREATE UNIQUE INDEX `idx_z_system_hooks_filename` ON `z_system_hooks_do_not_touch` (`filename`)"
            ]
        });
        app.save(colHooks);
    }

    // 3. z_system_migrations_do_not_touch
    try {
        app.findCollectionByNameOrId("z_system_migrations_do_not_touch");
    } catch (_) {
        const colMigrations = new Collection({
            name: "z_system_migrations_do_not_touch",
            type: "base",
            listRule: null,
            viewRule: null,
            createRule: null,
            updateRule: null,
            deleteRule: null,
            fields: [
                { name: "created", type: "autodate", onCreate: true },
                { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
                { name: "name", type: "text", required: true },
                { name: "up_code", type: "editor", required: true },
                { name: "down_code", type: "editor" },
                { name: "applied", type: "bool" },
                { name: "applied_at", type: "date" },
                { name: "error", type: "text" }
            ],
            indexes: [
                "CREATE UNIQUE INDEX `idx_z_system_migrations_name` ON `z_system_migrations_do_not_touch` (`name`)"
            ]
        });
        app.save(colMigrations);
    }
}, (app) => {
    try {
        const col1 = app.findCollectionByNameOrId("z_system_settings_do_not_touch");
        app.delete(col1);
    } catch (_) {}

    try {
        const col2 = app.findCollectionByNameOrId("z_system_hooks_do_not_touch");
        app.delete(col2);
    } catch (_) {}

    try {
        const col3 = app.findCollectionByNameOrId("z_system_migrations_do_not_touch");
        app.delete(col3);
    } catch (_) {}
});
