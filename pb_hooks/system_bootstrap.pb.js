// pb_hooks/system_bootstrap.pb.js
/// <reference path="../pb_data/types.d.ts" />

(function () {
    /**
     * Bootstrap Initialization Script for pb-core infrastructure.
     * Ensures system collections exist, initializes env_helper (generating master key if missing),
     * synchronizes active dynamic hooks to disk, and re-applies pending hot migrations on startup.
     */

    onBootstrap((e) => {
        e.next();

        function ensureCollectionExists(name, fields, indexes) {
            try {
                $app.findCollectionByNameOrId(name);
            } catch (_) {
                console.log("[BOOTSTRAP] Creating missing system collection:", name);
                const col = new Collection({
                    name: name,
                    type: "base",
                    listRule: null,   // Lock down API access by default; handled via routerAdd APIs
                    viewRule: null,
                    createRule: null,
                    updateRule: null,
                    deleteRule: null,
                    fields: fields,
                    indexes: indexes || []
                });
                $app.save(col);
            }
        }

        var COLLECTION_SETTINGS = "z_system_settings_do_not_touch";
        var COLLECTION_HOOKS = "z_system_hooks_do_not_touch";
        var COLLECTION_MIGRATIONS = "z_system_migrations_do_not_touch";

        console.log("[BOOTSTRAP] Initializing pb-core infrastructure...");

    // 1. Auto-create 3 system collections if they don't exist
    ensureCollectionExists(COLLECTION_SETTINGS, [
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
        { type: "text", name: "key", required: true },
        { type: "text", name: "value" },
        { type: "bool", name: "is_encrypted" }
    ], [
        "CREATE UNIQUE INDEX idx_z_sys_settings_key ON z_system_settings_do_not_touch (key)"
    ]);

    ensureCollectionExists(COLLECTION_HOOKS, [
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
        { type: "text", name: "filename", required: true },
        { type: "text", name: "content", required: true },
        { type: "bool", name: "active" }
    ], [
        "CREATE UNIQUE INDEX idx_z_sys_hooks_filename ON z_system_hooks_do_not_touch (filename)"
    ]);

    ensureCollectionExists(COLLECTION_MIGRATIONS, [
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
        { type: "text", name: "name", required: true },
        { type: "text", name: "up_code", required: true },
        { type: "text", name: "down_code" },
        { type: "bool", name: "applied" },
        { type: "text", name: "applied_at" },
        { type: "text", name: "error" }
    ], [
        "CREATE UNIQUE INDEX idx_z_sys_migrations_name ON z_system_migrations_do_not_touch (name)"
    ]);

    // 2. Initialize env_helper.js (guarantees master key generation of 124 chars in pb_data/.encryption_key)
    try {
        const envHelper = require(`${__hooks}/env_helper.js`);
        envHelper.getMasterKey();
        console.log("[BOOTSTRAP] Master key initialized via env_helper.js");
    } catch (envErr) {
        console.log("[BOOTSTRAP ERROR] Failed to initialize env_helper:", envErr.message);
    }

    // 3. Synchronize active dynamic hooks (active = true) to disk
    try {
        const { syncHookFromRecord } = require(`${__hooks}/system_hooks_manager.js`);
        const records = $app.findAllRecords(COLLECTION_HOOKS);
        for (let i = 0; i < records.length; i++) {
            const rec = records[i];
            if (rec.getBool("active")) {
                syncHookFromRecord(rec);
            }
        }
        console.log("[BOOTSTRAP] Dynamic hooks synchronized to disk successfully.");
    } catch (hooksErr) {
        console.log("[BOOTSTRAP ERROR] Dynamic hooks sync failed:", hooksErr.message);
    }

    // 4. Re-apply pending dynamic migrations (applied = false with non-empty up_code) in atomic transactions txApp
    try {
        const records = $app.findRecordsByFilter(
            COLLECTION_MIGRATIONS,
            "(applied = false || applied = null) && up_code != ''",
            "created ASC",
            100,
            0
        );

        for (let i = 0; i < records.length; i++) {
            const rec = records[i];
            const migName = rec.getString("name");
            const upCode = rec.getString("up_code");

            console.log("[BOOTSTRAP] Executing pending migration:", migName);

            try {
                $app.runInTransaction((txApp) => {
                    const fn = new Function("$app", "$os", "$security", upCode);
                    fn(txApp, $os, $security);
                });

                rec.set("applied", true);
                rec.set("applied_at", new Date().toISOString());
                rec.set("error", "");
                $app.save(rec);
                console.log("[BOOTSTRAP] Migration applied successfully:", migName);

            } catch (migErr) {
                console.log("[BOOTSTRAP ERROR] Migration execution failed for:", migName, "-", migErr.message);
                rec.set("applied", false);
                rec.set("error", migErr.message || "Execution error on bootstrap");
                $app.save(rec);
            }
        }
    } catch (migListErr) {
        console.log("[BOOTSTRAP ERROR] Failed to query pending migrations:", migListErr.message);
    }

    // Auto-migrate plaintext plugin_settings to encrypted z_system_settings
    (function autoMigratePlaintextSettings() {
        var SENSITIVE_KEYS = ["clip_api_key", "pocketbase_url", "clip_webhook_secret"];
        var SENTINEL = "[ENCRYPTED:z_system_settings]";

        try {
            var envHelper = require(`${__hooks}/env_helper.js`);
        } catch (err) {
            console.log("[BOOTSTRAP] env_helper not available, skipping migration:", err.message);
            return;
        }

        for (var i = 0; i < SENSITIVE_KEYS.length; i++) {
            var key = SENSITIVE_KEYS[i];
            try {
                var psRec = null;
                try {
                    psRec = $app.findFirstRecordByFilter("plugin_settings", "key = {:k}", { k: key });
                } catch (_) { continue; }

                if (!psRec) continue;
                var currentVal = psRec.getString("value");

                if (currentVal === SENTINEL || currentVal === "" || currentVal === "[ENCRYPTED]") {
                    continue;
                }

                var existingEncrypted = null;
                try {
                    existingEncrypted = envHelper.getEnv(key);
                } catch (_) {}

                if (!existingEncrypted) {
                    envHelper.setEnv(key, currentVal, true);
                    console.log("[BOOTSTRAP] Migrated key to encrypted store:", key);
                }

                psRec.set("value", SENTINEL);
                $app.save(psRec);
                console.log("[BOOTSTRAP] Plaintext cleared from plugin_settings for key:", key);

            } catch (migErr) {
                console.log("[BOOTSTRAP] Migration error for key:", key, "-", migErr.message);
            }
        }
    })();
});

// Event listeners for z_system_hooks_do_not_touch live disk sync
onRecordAfterCreateSuccess((e) => {
    e.next();
    try {
        const { syncHookFromRecord } = require(`${__hooks}/system_hooks_manager.js`);
        syncHookFromRecord(e.record);
    } catch (err) {
        console.log("[HOOK SYNC ERROR] AfterCreate sync failed:", err.message);
    }
}, "z_system_hooks_do_not_touch");

onRecordAfterUpdateSuccess((e) => {
    e.next();
    try {
        const { syncHookFromRecord } = require(`${__hooks}/system_hooks_manager.js`);
        syncHookFromRecord(e.record);
    } catch (err) {
        console.log("[HOOK SYNC ERROR] AfterUpdate sync failed:", err.message);
    }
}, "z_system_hooks_do_not_touch");

onRecordAfterDeleteSuccess((e) => {
    e.next();
    try {
        const { removeHookFromDisk } = require(`${__hooks}/system_hooks_manager.js`);
        const filename = e.record.getString("filename");
        removeHookFromDisk(filename);
    } catch (err) {
        console.log("[HOOK SYNC ERROR] AfterDelete remove failed:", err.message);
    }
}, "z_system_hooks_do_not_touch");
})();
