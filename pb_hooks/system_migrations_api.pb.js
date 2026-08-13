// pb_hooks/system_migrations_api.pb.js
/// <reference path="../pb_data/types.d.ts" />

(function () {
    var COLLECTION_MIGRATIONS = "z_system_migrations_do_not_touch";
    var MAX_CODE_SIZE = 262144; // 256 KB

    /**
     * Validates migration name strictly.
     * @param {string} name
     */
    function validateMigrationName(name) {
        if (!name || typeof name !== "string" || name.length > 128) {
            throw new BadRequestError("Migration name must be a non-empty string under 128 characters.");
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            throw new BadRequestError("Invalid migration name format. Only letters, numbers, underscores, and hyphens allowed.");
        }
    }

    /**
     * Validates JS migration code size and basic syntax.
     * @param {string} code
     * @param {string} fieldName
     */
    function validateMigrationCode(code, fieldName) {
        fieldName = fieldName || "code";
        if (!code || typeof code !== "string") {
            throw new BadRequestError("Field '" + fieldName + "' must be a non-empty string.");
        }
        if (code.length > MAX_CODE_SIZE) {
            throw new BadRequestError("Field '" + fieldName + "' exceeds maximum size of 256KB.");
        }
        try {
            new Function("$app", "$os", "$security", code);
        } catch (err) {
            throw new BadRequestError("Syntax validation error in '" + fieldName + "': " + err.message);
        }
    }

    routerAdd("POST", "/api/v1/system/migrations", (e) => {
        const { requireSuperuser } = require(`${__hooks}/system_auth.js`);

        requireSuperuser(e);

        try {
            const { checkLimit } = require(`${__hooks}/rate_limiter.js`);
            const clientIp = e.realIP || e.remoteIP || "unknown";
            const limit = checkLimit("migrations_api:" + clientIp, 15, 60000);
            if (!limit.allowed) {
                return e.json(429, { status: "error", code: "rate_limited", message: "Too many requests. Please try again later." });
            }
        } catch (_) {}

        const data = e.requestInfo().body || {};
        const name = data.name;
        const upCode = data.up_code;
        const downCode = data.down_code || "";

        try {
            validateMigrationName(name);
            validateMigrationCode(upCode, "up_code");
            if (downCode) {
                validateMigrationCode(downCode, "down_code");
            }

            let record = null;
            try {
                const records = $app.findRecordsByFilter(
                    COLLECTION_MIGRATIONS,
                    "name = {:name}",
                    "",
                    1,
                    0,
                    { name: name }
                );
                if (records && records.length > 0) {
                    record = records[0];
                }
            } catch (_) {}

            if (!record) {
                const col = $app.findCollectionByNameOrId(COLLECTION_MIGRATIONS);
                record = new Record(col);
                record.set("name", name);
            }

            record.set("up_code", upCode);
            record.set("down_code", downCode);

            // Execute migration within isolated transaction, passing txApp as $app to prevent deadlocks
            $app.runInTransaction((txApp) => {
                const fn = new Function("$app", "$os", "$security", upCode);
                fn(txApp, $os, $security);
            });

            record.set("applied", true);
            record.set("applied_at", new Date().toISOString());
            record.set("error", "");
            $app.save(record);

            return e.json(200, {
                status: "success",
                message: "Migration '" + name + "' executed and applied successfully",
                name: name,
                applied: true
            });

        } catch (err) {
            console.log("[SYSTEM MIGRATIONS API ERROR] POST failed for migration:", name, "-", err.message);

            // Record failure in DB if name is valid
            try {
                if (name && typeof name === "string" && /^[a-zA-Z0-9_-]+$/.test(name)) {
                    let rec = null;
                    const records = $app.findRecordsByFilter(COLLECTION_MIGRATIONS, "name = {:name}", "", 1, 0, { name: name });
                    if (records && records.length > 0) {
                        rec = records[0];
                    } else {
                        const col = $app.findCollectionByNameOrId(COLLECTION_MIGRATIONS);
                        rec = new Record(col);
                        rec.set("name", name);
                    }
                    rec.set("up_code", upCode || "");
                    rec.set("down_code", downCode || "");
                    rec.set("applied", false);
                    rec.set("error", err.message || "Migration execution failed");
                    $app.save(rec);
                }
            } catch (_) {}

            return e.json(err.status || 500, {
                status: "error",
                code: "migration_failed",
                message: err.message || "Migration execution failed.",
                name: name
            });
        }
    });

    routerAdd("POST", "/api/v1/system/migrations/rollback", (e) => {
        const { requireSuperuser } = require(`${__hooks}/system_auth.js`);

        requireSuperuser(e);

        try {
            const { checkLimit } = require(`${__hooks}/rate_limiter.js`);
            const clientIp = e.realIP || e.remoteIP || "unknown";
            const limit = checkLimit("migrations_api:" + clientIp, 15, 60000);
            if (!limit.allowed) {
                return e.json(429, { status: "error", code: "rate_limited", message: "Too many requests. Please try again later." });
            }
        } catch (_) {}

        const data = e.requestInfo().body || {};
        const name = data.name;

        try {
            validateMigrationName(name);

            const records = $app.findRecordsByFilter(
                COLLECTION_MIGRATIONS,
                "name = {:name}",
                "",
                1,
                0,
                { name: name }
            );

            if (!records || records.length === 0) {
                return e.json(404, { status: "error", code: "not_found", message: "Migration '" + name + "' not found." });
            }

            const record = records[0];
            const isApplied = record.getBool("applied");
            const downCode = record.getString("down_code");

            if (!isApplied) {
                return e.json(400, { status: "error", code: "not_applied", message: "Migration '" + name + "' is not currently applied." });
            }

            if (!downCode || downCode.trim() === "") {
                return e.json(400, { status: "error", code: "no_down_code", message: "Migration '" + name + "' does not define down_code rollback steps." });
            }

            validateMigrationCode(downCode, "down_code");

            // Execute rollback within transaction
            $app.runInTransaction((txApp) => {
                const fn = new Function("$app", "$os", "$security", downCode);
                fn(txApp, $os, $security);
            });

            record.set("applied", false);
            record.set("error", "");
            $app.save(record);

            return e.json(200, {
                status: "success",
                message: "Migration '" + name + "' rolled back successfully",
                name: name,
                applied: false
            });

        } catch (err) {
            console.log("[SYSTEM MIGRATIONS API ERROR] Rollback failed for migration:", name, "-", err.message);
            return e.json(err.status || 500, {
                status: "error",
                code: "rollback_failed",
                message: err.message || "Rollback execution failed.",
                name: name
            });
        }
    });

    routerAdd("GET", "/api/v1/system/migrations", (e) => {
        const { requireSuperuser } = require(`${__hooks}/system_auth.js`);

        requireSuperuser(e);

        try {
            const { checkLimit } = require(`${__hooks}/rate_limiter.js`);
            const clientIp = e.realIP || e.remoteIP || "unknown";
            const limit = checkLimit("migrations_api:" + clientIp, 60, 60000);
            if (!limit.allowed) {
                return e.json(429, { status: "error", code: "rate_limited", message: "Too many requests. Please try again later." });
            }
        } catch (_) {}

        const info = e.requestInfo();
        const name = info.query["name"] || info.query.name;

        if (name) {
            try {
                validateMigrationName(name);
                const records = $app.findRecordsByFilter(
                    COLLECTION_MIGRATIONS,
                    "name = {:name}",
                    "",
                    1,
                    0,
                    { name: name }
                );

                if (records && records.length > 0) {
                    const r = records[0];
                    return e.json(200, {
                        status: "success",
                        name: r.getString("name"),
                        up_code: r.getString("up_code"),
                        down_code: r.getString("down_code"),
                        applied: r.getBool("applied"),
                        applied_at: r.getString("applied_at"),
                        error: r.getString("error"),
                        created: r.getString("created"),
                        updated: r.getString("updated")
                    });
                }
                return e.json(404, { status: "error", code: "not_found", message: "Migration '" + name + "' not found." });
            } catch (err) {
                console.log("[SYSTEM MIGRATIONS API ERROR] GET specific failed:", err.message);
                return e.json(err.status || 500, {
                    status: "error",
                    code: "get_error",
                    message: err.message || "Failed to retrieve migration."
                });
            }
        }

        try {
            const records = $app.findAllRecords(COLLECTION_MIGRATIONS);
            const list = records.map((r) => ({
                id: r.id,
                name: r.getString("name"),
                applied: r.getBool("applied"),
                applied_at: r.getString("applied_at"),
                has_error: r.getString("error") !== "",
                updated: r.getString("updated")
            }));
            return e.json(200, { status: "success", items: list });
        } catch (err) {
            console.log("[SYSTEM MIGRATIONS API ERROR] GET list failed:", err.message);
            return e.json(500, { status: "error", code: "list_error", message: "Failed to list migrations." });
        }
    });

    routerAdd("DELETE", "/api/v1/system/migrations", (e) => {
        const { requireSuperuser } = require(`${__hooks}/system_auth.js`);

        requireSuperuser(e);

        try {
            const { checkLimit } = require(`${__hooks}/rate_limiter.js`);
            const clientIp = e.realIP || e.remoteIP || "unknown";
            const limit = checkLimit("migrations_api:" + clientIp, 20, 60000);
            if (!limit.allowed) {
                return e.json(429, { status: "error", code: "rate_limited", message: "Too many requests. Please try again later." });
            }
        } catch (_) {}

        const info = e.requestInfo();
        const data = info.body || {};
        const name = info.query["name"] || info.query.name || data.name;

        if (!name) {
            return e.json(400, { status: "error", code: "missing_name", message: "Parameter 'name' is required." });
        }

        try {
            validateMigrationName(name);

            const records = $app.findRecordsByFilter(
                COLLECTION_MIGRATIONS,
                "name = {:name}",
                "",
                1,
                0,
                { name: name }
            );

            if (records && records.length > 0) {
                const rec = records[0];
                const isApplied = rec.getBool("applied");
                const force = (info.query["force"] || data.force) === "true" || data.force === true;

                if (isApplied && !force) {
                    return e.json(409, {
                        status: "error",
                        code: "still_applied",
                        message: "Migration '" + name + "' is currently applied. Roll it back first, or pass force=true to delete without rollback (WARNING: schema state will be orphaned)."
                    });
                }

                $app.delete(rec);
                return e.json(200, { status: "success", message: "Migration '" + name + "' record deleted successfully." + (isApplied ? " (forced delete — schema changes remain in DB)" : "") });
            }
            return e.json(404, { status: "error", code: "not_found", message: "Migration '" + name + "' not found." });
        } catch (err) {
            console.log("[SYSTEM MIGRATIONS API ERROR] DELETE failed:", err.message);
            return e.json(err.status || 500, {
                status: "error",
                code: "delete_error",
                message: err.message || "Failed to delete migration record."
            });
        }
    });
})();
