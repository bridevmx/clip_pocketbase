// pb_hooks/system_settings_api.pb.js
/// <reference path="../pb_data/types.d.ts" />

routerAdd("POST", "/api/v1/system/config", (e) => {
    const { requireSuperuser } = require(`${__hooks}/system_auth.js`);
    const { setEnv } = require(`${__hooks}/env_helper.js`);

    requireSuperuser(e);

    try {
        const { checkLimit } = require(`${__hooks}/rate_limiter.js`);
        const clientIp = e.realIP || e.remoteIP || "unknown";
        const limit = checkLimit("settings_api:" + clientIp, 30, 60000);
        if (!limit.allowed) {
            return e.json(429, { status: "error", code: "rate_limited", message: "Too many requests. Please try again later." });
        }
    } catch (_) {
        // rate_limiter optional
    }

    const info = e.requestInfo();
    const data = info.body || {};
    const key = data.key;
    const value = data.value;
    const isEncrypted = data.is_encrypted !== false;

    if (!key || value === undefined) {
        return e.json(400, { status: "error", code: "missing_fields", message: "Fields 'key' and 'value' are required." });
    }

    try {
        setEnv(key, value, isEncrypted);
        return e.json(200, {
            status: "success",
            message: "Configuration '" + key + "' saved successfully" + (isEncrypted ? " (encrypted)" : ""),
            key: key
        });
    } catch (err) {
        console.log("[SYSTEM SETTINGS API ERROR] POST failed:", err.message);
        return e.json(err.status || 500, {
            status: "error",
            code: "save_error",
            message: err.message || "Failed to save system setting."
        });
    }
});

routerAdd("GET", "/api/v1/system/config", (e) => {
    const { requireSuperuser } = require(`${__hooks}/system_auth.js`);
    const { getEnv } = require(`${__hooks}/env_helper.js`);

    requireSuperuser(e);

    try {
        const { checkLimit } = require(`${__hooks}/rate_limiter.js`);
        const clientIp = e.realIP || e.remoteIP || "unknown";
        const limit = checkLimit("settings_api:" + clientIp, 60, 60000);
        if (!limit.allowed) {
            return e.json(429, { status: "error", code: "rate_limited", message: "Too many requests. Please try again later." });
        }
    } catch (_) {}

    const info = e.requestInfo();
    const key = info.query["key"] || info.query.key;
    const COLLECTION_SETTINGS = "z_system_settings_do_not_touch";

    // Requesting a specific key setting
    if (key) {
        try {
            const value = getEnv(key);
            if (value === null) {
                return e.json(404, { status: "error", code: "not_found", message: "Setting '" + key + "' not found." });
            }
            return e.json(200, { status: "success", key: key, value: value });
        } catch (err) {
            console.log("[SYSTEM SETTINGS API ERROR] GET key failed:", err.message);
            return e.json(err.status || 500, { status: "error", code: "get_error", message: err.message || "Failed to retrieve setting." });
        }
    }

    // Listing all keys (DO NOT RETURN SENSITIVE VALUES IN LIST)
    try {
        const records = $app.findAllRecords(COLLECTION_SETTINGS);
        const list = records.map((r) => ({
            id: r.id,
            key: r.getString("key"),
            is_encrypted: r.getBool("is_encrypted"),
            created: r.getString("created"),
            updated: r.getString("updated")
        }));
        return e.json(200, { status: "success", items: list });
    } catch (err) {
        console.log("[SYSTEM SETTINGS API ERROR] GET list failed:", err.message);
        return e.json(500, { status: "error", code: "list_error", message: "Failed to list system settings." });
    }
});

routerAdd("DELETE", "/api/v1/system/config", (e) => {
    const { requireSuperuser } = require(`${__hooks}/system_auth.js`);
    const { deleteEnv } = require(`${__hooks}/env_helper.js`);

    requireSuperuser(e);

    try {
        const { checkLimit } = require(`${__hooks}/rate_limiter.js`);
        const clientIp = e.realIP || e.remoteIP || "unknown";
        const limit = checkLimit("settings_api:" + clientIp, 20, 60000);
        if (!limit.allowed) {
            return e.json(429, { status: "error", code: "rate_limited", message: "Too many requests. Please try again later." });
        }
    } catch (_) {}

    const info = e.requestInfo();
    const data = info.body || {};
    const key = info.query["key"] || info.query.key || data.key;

    if (!key) {
        return e.json(400, { status: "error", code: "missing_key", message: "Parameter 'key' is required." });
    }

    try {
        const deleted = deleteEnv(key);
        if (deleted) {
            return e.json(200, { status: "success", message: "Setting '" + key + "' deleted successfully." });
        }
        return e.json(404, { status: "error", code: "not_found", message: "Setting '" + key + "' not found." });
    } catch (err) {
        console.log("[SYSTEM SETTINGS API ERROR] DELETE failed:", err.message);
        return e.json(err.status || 500, { status: "error", code: "delete_error", message: err.message || "Failed to delete setting." });
    }
});
