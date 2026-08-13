// pb_hooks/system_auth.js
/**
 * System Authentication & Authorization Helper for PocketBase v0.23+
 * Provides centralized permission checks for superusers and plugin admins.
 */

/**
 * Checks if the request context originates from an authenticated superuser.
 * @param {object} e - Router request context (e.g. from routerAdd handler)
 * @returns {boolean}
 */
function isSuperuser(e) {
    if (!e) {
        return false;
    }
    if (typeof e.hasSuperuserAuth === "function" && e.hasSuperuserAuth()) {
        return true;
    }
    if (e.auth && typeof e.auth.collection === "function") {
        const col = e.auth.collection();
        if (col && col.name === "_superusers") {
            return true;
        }
    }
    return false;
}

/**
 * Ensures the request is made by an authenticated superuser.
 * Checks e.hasSuperuserAuth() or e.auth in _superusers collection.
 * If { identity, password } credentials are provided in the request body,
 * verifies them using adminRecord.validatePassword(password).
 * Throws ForbiddenError("Superuser authentication required.") if check fails.
 * @param {object} e - Router request context
 */
function requireSuperuser(e) {
    if (isSuperuser(e)) {
        return true;
    }

    if (e && typeof e.requestInfo === "function") {
        try {
            const info = e.requestInfo();
            const data = info ? (info.body || {}) : {};
            const identity = data.identity || data.username || data.email;
            const password = data.password;

            if (identity && password) {
                let suRecord = null;
                try {
                    suRecord = $app.findAuthRecordByEmail("_superusers", identity);
                } catch (_) {
                    try {
                        suRecord = $app.findFirstRecordByFilter(
                            "_superusers",
                            "email = {:id} || username = {:id}",
                            { id: identity }
                        );
                    } catch (_) {}
                }

                if (suRecord && typeof suRecord.validatePassword === "function" && suRecord.validatePassword(password)) {
                    return true;
                }
            }
        } catch (_) {}
    }

    throw new ForbiddenError("Superuser authentication required.");
}

/**
 * Checks if a given user ID belongs to a superuser or is listed in plugin_settings.admin_user_ids.
 * @param {string} userId - User record ID
 * @returns {boolean}
 */
function isPluginAdmin(userId) {
    if (!userId || typeof userId !== "string") {
        return false;
    }

    var cleanUserId = userId.trim();
    if (!cleanUserId) {
        return false;
    }
    userId = cleanUserId;

    // 1. Check if user is superuser
    try {
        const su = $app.findRecordById("_superusers", userId);
        if (su) {
            return true;
        }
    } catch (_) {}

    // 2. Check z_system_settings_do_not_touch collection
    try {
        const { getEnv } = require(`${__hooks}/env_helper.js`);
        const adminIdsStr = getEnv("admin_user_ids");
        if (adminIdsStr) {
            const ids = adminIdsStr.split(",");
            for (let i = 0; i < ids.length; i++) {
                if (ids[i].trim() === userId) {
                    return true;
                }
            }
        }
    } catch (_) {}

    return false;
}

/**
 * Ensures the request is made by either a superuser or a designated plugin admin.
 * @param {object} e - Router request context
 */
function requirePluginAdmin(e) {
    if (!e || !e.auth) {
        throw new ForbiddenError("Superuser authentication required.");
    }
    if (isSuperuser(e)) {
        return;
    }
    if (isPluginAdmin(e.auth.id)) {
        return;
    }
    throw new ForbiddenError("Plugin administrator privileges required.");
}

/**
 * Safely extracts the superuser record from the request context if valid.
 * @param {object} e - Router request context
 * @returns {object|null}
 */
function getSuperuserFromRequest(e) {
    if (isSuperuser(e)) {
        return e.auth;
    }
    return null;
}

module.exports = Object.freeze({
    isSuperuser,
    requireSuperuser,
    isPluginAdmin,
    requirePluginAdmin,
    getSuperuserFromRequest
});
