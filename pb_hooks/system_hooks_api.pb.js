// pb_hooks/system_hooks_api.pb.js
/// <reference path="../pb_data/types.d.ts" />

const COLLECTION_HOOKS = "z_system_hooks_do_not_touch";

const PROTECTED_CORE_FILES = [
    "clip_00_bootstrap.pb.js",
    "spei_00_bootstrap.pb.js",
    "system_bootstrap.pb.js",
    "system_auth.js",
    "env_helper.js",
    "plugin_config_validator.js",
    "plugin_settings_helper.js",
    "rate_limiter.js",
    "setup_wizard.pb.js"
];

/**
 * Validates extension filename strictly.
 * Must match /^[a-zA-Z0-9_-]+\.pb\.js$/ and must not be in PROTECTED_CORE_FILES.
 * @param {string} filename
 */
function validateExtensionFilename(filename) {
    if (!filename || typeof filename !== "string" || filename.length > 128) {
        throw new BadRequestError("Filename must be a string under 128 characters.");
    }
    if (!/^[a-zA-Z0-9_-]+\.pb\.js$/.test(filename)) {
        throw new BadRequestError("Invalid filename format. Must match /^[a-zA-Z0-9_-]+\\.pb\\.js$/.");
    }
    if (PROTECTED_CORE_FILES.indexOf(filename) !== -1) {
        throw new ForbiddenError("Cannot modify or delete protected core file: " + filename);
    }
}

/**
 * Validates extension code syntax and length.
 * @param {string} content
 */
function validateExtensionContent(content) {
    if (content === undefined || content === null || typeof content !== "string") {
        throw new BadRequestError("Field 'content' must be a non-null string.");
    }
    if (content.length > 524288) { // 512 KB
        throw new BadRequestError("Extension content exceeds maximum size of 512KB.");
    }
    try {
        new Function(content);
    } catch (syntaxErr) {
        throw new BadRequestError("JavaScript syntax validation failed: " + syntaxErr.message);
    }
}

routerAdd("POST", "/api/v1/system/extensions", (e) => {
    const { requireSuperuser } = require(`${__hooks}/system_auth.js`);

    requireSuperuser(e);

    try {
        const { checkLimit } = require(`${__hooks}/rate_limiter.js`);
        const clientIp = e.realIP || e.remoteIP || "unknown";
        const limit = checkLimit("hooks_api:" + clientIp, 20, 60000);
        if (!limit.allowed) {
            return e.json(429, { status: "error", code: "rate_limited", message: "Too many requests. Please try again later." });
        }
    } catch (_) {}

    const info = e.requestInfo();
    const data = info.body || {};
    const filename = data.filename;
    const content = data.content;
    const active = data.active !== false;

    if (!filename || content === undefined) {
        return e.json(400, { status: "error", code: "missing_fields", message: "Fields 'filename' and 'content' are required." });
    }

    try {
        validateExtensionFilename(filename);
        validateExtensionContent(content);

        let record = null;
        try {
            const records = $app.findRecordsByFilter(
                COLLECTION_HOOKS,
                "filename = {:fn}",
                "",
                1,
                0,
                { fn: filename }
            );
            if (records && records.length > 0) {
                record = records[0];
            }
        } catch (_) {}

        if (!record) {
            const col = $app.findCollectionByNameOrId(COLLECTION_HOOKS);
            record = new Record(col);
            record.set("filename", filename);
        }

        record.set("content", content);
        record.set("active", active);
        $app.save(record);

        const filePath = `${__hooks}/${filename}`;
        if (active) {
            $os.writeFile(filePath, content, 0o644);
        } else {
            try {
                $os.remove(filePath);
            } catch (_) {}
        }

        return e.json(200, {
            status: "success",
            message: "Extension '" + filename + "' saved and synchronized successfully",
            filename: filename,
            active: active
        });
    } catch (err) {
        console.log("[SYSTEM HOOKS API ERROR] POST failed:", err.message);
        return e.json(err.status || 500, {
            status: "error",
            code: "save_error",
            message: err.message || "Failed to save extension."
        });
    }
});

routerAdd("GET", "/api/v1/system/extensions", (e) => {
    const { requireSuperuser } = require(`${__hooks}/system_auth.js`);

    requireSuperuser(e);

    try {
        const { checkLimit } = require(`${__hooks}/rate_limiter.js`);
        const clientIp = e.realIP || e.remoteIP || "unknown";
        const limit = checkLimit("hooks_api:" + clientIp, 60, 60000);
        if (!limit.allowed) {
            return e.json(429, { status: "error", code: "rate_limited", message: "Too many requests. Please try again later." });
        }
    } catch (_) {}

    const info = e.requestInfo();
    const filename = info.query["filename"] || info.query.filename;

    if (filename) {
        try {
            validateExtensionFilename(filename);
            const records = $app.findRecordsByFilter(
                COLLECTION_HOOKS,
                "filename = {:fn}",
                "",
                1,
                0,
                { fn: filename }
            );
            if (records && records.length > 0) {
                const r = records[0];
                return e.json(200, {
                    status: "success",
                    filename: r.getString("filename"),
                    content: r.getString("content"),
                    active: r.getBool("active"),
                    created: r.getString("created"),
                    updated: r.getString("updated")
                });
            }
            return e.json(404, { status: "error", code: "not_found", message: "Extension '" + filename + "' not found." });
        } catch (err) {
            console.log("[SYSTEM HOOKS API ERROR] GET specific failed:", err.message);
            return e.json(err.status || 500, {
                status: "error",
                code: "get_error",
                message: err.message || "Failed to retrieve extension."
            });
        }
    }

    try {
        const records = $app.findAllRecords(COLLECTION_HOOKS);
        const list = records.map((r) => ({
            id: r.id,
            filename: r.getString("filename"),
            active: r.getBool("active"),
            created: r.getString("created"),
            updated: r.getString("updated")
        }));
        return e.json(200, { status: "success", items: list });
    } catch (err) {
        console.log("[SYSTEM HOOKS API ERROR] GET list failed:", err.message);
        return e.json(500, { status: "error", code: "list_error", message: "Failed to list extensions." });
    }
});

routerAdd("DELETE", "/api/v1/system/extensions", (e) => {
    const { requireSuperuser } = require(`${__hooks}/system_auth.js`);

    requireSuperuser(e);

    try {
        const { checkLimit } = require(`${__hooks}/rate_limiter.js`);
        const clientIp = e.realIP || e.remoteIP || "unknown";
        const limit = checkLimit("hooks_api:" + clientIp, 20, 60000);
        if (!limit.allowed) {
            return e.json(429, { status: "error", code: "rate_limited", message: "Too many requests. Please try again later." });
        }
    } catch (_) {}

    const info = e.requestInfo();
    const data = info.body || {};
    const filename = info.query["filename"] || info.query.filename || data.filename;

    if (!filename) {
        return e.json(400, { status: "error", code: "missing_filename", message: "Parameter 'filename' is required." });
    }

    try {
        validateExtensionFilename(filename);
        const records = $app.findRecordsByFilter(
            COLLECTION_HOOKS,
            "filename = {:fn}",
            "",
            1,
            0,
            { fn: filename }
        );

        if (records && records.length > 0) {
            $app.delete(records[0]);
            const filePath = `${__hooks}/${filename}`;
            try {
                $os.remove(filePath);
            } catch (_) {}
            return e.json(200, { status: "success", message: "Extension '" + filename + "' deleted successfully." });
        }
        return e.json(404, { status: "error", code: "not_found", message: "Extension '" + filename + "' not found." });
    } catch (err) {
        console.log("[SYSTEM HOOKS API ERROR] DELETE failed:", err.message);
        return e.json(err.status || 500, {
            status: "error",
            code: "delete_error",
            message: err.message || "Failed to delete extension."
        });
    }
});
