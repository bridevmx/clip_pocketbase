// pb_hooks/plugin_settings_helper.js
/**
 * Plugin Settings Helper Module for PocketBase v0.23+
 * Safe accessor functions for dynamic plugin configurations and admin verification.
 *
 * Provides centralized access control and settings retrieval for both CLIP + SPEI plugin
 * and general system configurations.
 */

/**
 * Gets a raw setting value as string from z_system_settings_do_not_touch.
 * @param {string} key
 * @param {string} [defaultValue=""]
 * @returns {string}
 */
function getSetting(key, defaultValue) {
    var fallback = defaultValue !== undefined ? String(defaultValue) : "";
    if (!key || typeof key !== "string") {
        return fallback;
    }
    try {
        var envHelper = require(`${__hooks}/env_helper.js`);
        var val = envHelper.getEnv(key);
        if (val !== null && val !== undefined && val !== "") {
            return String(val);
        }
    } catch (_) {
        // Table or key not found
    }
    return fallback;
}

/**
 * Reads a value from environment variables first.
 * Checks OS environment, then encrypted system settings (z_system_settings_do_not_touch),
 * and falls back to defaultValue only. (NO plaintext fallback).
 *
 * @param {string} envKey
 * @param {string} settingKey
 * @param {string} [defaultValue=""]
 * @returns {string}
 */
function getEnvOrSetting(envKey, settingKey, defaultValue) {
    // Step 1: OS environment variable (highest priority, required for ENCRYPTION_KEY itself)
    if (envKey) {
        var envVal = $os.getenv(envKey);
        if (envVal && envVal.trim() !== "") {
            return envVal;
        }
    }
    // Step 2: Encrypted system settings (z_system_settings_do_not_touch)
    // This is the ONLY DB storage. ENCRYPTION_KEY must be set for this to work.
    if (settingKey) {
        try {
            var helper = require(`${__hooks}/env_helper.js`);
            var encVal = helper.getEnv(settingKey);
            if (encVal !== null && encVal !== undefined && encVal !== "") {
                return encVal;
            }
        } catch (err) {
            // ENCRYPTION_KEY not configured — this is a hard failure in production
            // Log the error but don't expose details
            console.log("[SECURITY] getEnvOrSetting: encrypted store unavailable for key:", settingKey);
        }
    }
    // Step 3: Default value only
    return defaultValue !== undefined ? defaultValue : "";
}

/**
 * Gets a setting parsed as boolean.
 * @param {string} key
 * @param {boolean} [defaultValue=false]
 * @returns {boolean}
 */
function getSettingBool(key, defaultValue) {
    var fallback = defaultValue !== undefined ? Boolean(defaultValue) : false;
    var raw = getSetting(key, "");
    if (raw === "") {
        return fallback;
    }
    var lower = raw.trim().toLowerCase();
    if (lower === "true" || lower === "1" || lower === "yes" || lower === "on") {
        return true;
    }
    if (lower === "false" || lower === "0" || lower === "no" || lower === "off") {
        return false;
    }
    return fallback;
}

/**
 * Gets a setting parsed as integer.
 * @param {string} key
 * @param {number} [defaultValue=0]
 * @returns {number}
 */
function getSettingInt(key, defaultValue) {
    var fallback = defaultValue !== undefined ? Number(defaultValue) : 0;
    var raw = getSetting(key, "");
    if (raw === "") {
        return fallback;
    }
    var parsed = parseInt(raw, 10);
    return isNaN(parsed) ? fallback : parsed;
}

/**
 * Verifies if a user ID is a superuser or listed in plugin_settings.admin_user_ids.
 *
 * @param {string} userId
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

    // 1. Superuser check
    try {
        var su = $app.findRecordById("_superusers", cleanUserId);
        if (su) {
            return true;
        }
    } catch (_) {}

    // 2. Plugin setting admin list check
    var adminIdsStr = getSetting("admin_user_ids", "");
    if (!adminIdsStr) {
        return false;
    }

    var ids = adminIdsStr.split(",");
    for (var i = 0; i < ids.length; i++) {
        if (ids[i].trim() === cleanUserId) {
            return true;
        }
    }

    return false;
}

module.exports = Object.freeze({
    getSetting: getSetting,
    getEnvOrSetting: getEnvOrSetting,
    getSettingBool: getSettingBool,
    getSettingInt: getSettingInt,
    isPluginAdmin: isPluginAdmin
});
