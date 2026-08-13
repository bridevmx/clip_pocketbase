// pb_hooks/env_helper.js
/**
 * Secure Environment Variable Helper for PocketBase v0.23+
 * Reads and writes encrypted configuration settings stored in DB or system environment.
 */

const COLLECTION_SETTINGS = "z_system_settings_do_not_touch";
const MIN_KEY_LENGTH = 32;
const DEFAULT_KEY_LENGTH = 124;

/**
 * Retrieves or generates the master key.
 * 1. Checks $os.getenv("ENCRYPTION_KEY") (if exists and >= 32 chars).
 * 2. Checks existence of ${$app.dataDir()}/.encryption_key.
 * 3. If not found, generates a 124-character random key, persists to ${$app.dataDir()}/.encryption_key (0o600) and returns it.
 * @returns {string}
 */
function getMasterKey() {
    const envKey = $os.getenv("ENCRYPTION_KEY");
    if (envKey && envKey.length >= MIN_KEY_LENGTH) {
        return envKey;
    }

    const keyPath = `${$app.dataDir()}/.encryption_key`;
    try {
        const fileContent = $os.readFile(keyPath);
        if (fileContent) {
            const keyStr = String(fileContent).trim();
            if (keyStr.length >= MIN_KEY_LENGTH) {
                return keyStr;
            }
        }
    } catch (_) {
        // File does not exist or read failed
    }

    const newKey = $security.randomString(DEFAULT_KEY_LENGTH);
    try {
        $os.writeFile(keyPath, newKey, 0o600);
    } catch (writeErr) {
        console.log("[ENV HELPER ERROR] Failed to write .encryption_key file:", writeErr.message);
    }
    return newKey;
}

/**
 * Sanitizes key names (alphanumeric, dots, underscores, hyphens only).
 * @param {string} key
 */
function validateKey(key) {
    if (!key || typeof key !== "string" || key.length > 128) {
        throw new Error("Invalid key: Key must be a non-empty string under 128 characters.");
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(key)) {
        throw new Error("Invalid key format: Only letters, numbers, dots, underscores, and hyphens allowed.");
    }
}

/**
 * Gets an environment setting.
 * Checks z_system_settings_do_not_touch DB settings first, decrypting if is_encrypted.
 * Falls back to system OS environment variable.
 * @param {string} key
 * @returns {string|null}
 */
function getEnv(key) {
    validateKey(key);
    try {
        const records = $app.findRecordsByFilter(
            COLLECTION_SETTINGS,
            "key = {:key}",
            "",
            1,
            0,
            { key: key }
        );

        if (records && records.length > 0) {
            const record = records[0];
            const rawValue = record.getString("value");
            const isEncrypted = record.getBool("is_encrypted");

            if (isEncrypted && rawValue) {
                try {
                    const masterKey = getMasterKey();
                    return $security.decrypt(rawValue, masterKey);
                } catch (decErr) {
                    console.log("[ENV HELPER ERROR] Failed to decrypt setting for key:", key);
                    return null;
                }
            }
            return rawValue;
        }
    } catch (err) {
        console.log("[ENV HELPER ERROR] DB lookup failed for key:", key);
    }

    const osVal = $os.getenv(key);
    return osVal !== "" ? osVal : null;
}

/**
 * Sets an environment setting in z_system_settings_do_not_touch DB.
 * Encrypts value using getMasterKey() if isEncrypted is true (defaults to true).
 * @param {string} key
 * @param {string} plainValue
 * @param {boolean} [isEncrypted=true]
 */
function setEnv(key, plainValue, isEncrypted = true) {
    validateKey(key);
    if (plainValue === undefined || plainValue === null) {
        throw new Error("Value cannot be null or undefined.");
    }
    const stringVal = String(plainValue);
    if (stringVal.length > 16384) {
        throw new Error("Value size exceeds maximum limit of 16KB.");
    }

    let valueToSave = stringVal;
    if (isEncrypted && stringVal !== "") {
        const masterKey = getMasterKey();
        valueToSave = $security.encrypt(stringVal, masterKey);
    }

    let record = null;
    try {
        const records = $app.findRecordsByFilter(
            COLLECTION_SETTINGS,
            "key = {:key}",
            "",
            1,
            0,
            { key: key }
        );
        if (records && records.length > 0) {
            record = records[0];
        }
    } catch (_) {}

    if (!record) {
        const collection = $app.findCollectionByNameOrId(COLLECTION_SETTINGS);
        record = new Record(collection);
        record.set("key", key);
    }

    record.set("value", valueToSave);
    record.set("is_encrypted", isEncrypted);
    $app.save(record);
}

/**
 * Deletes an environment setting from DB.
 * @param {string} key
 * @returns {boolean} True if deleted, false if not found.
 */
function deleteEnv(key) {
    validateKey(key);
    const records = $app.findRecordsByFilter(
        COLLECTION_SETTINGS,
        "key = {:key}",
        "",
        1,
        0,
        { key: key }
    );

    if (records && records.length > 0) {
        $app.delete(records[0]);
        return true;
    }
    return false;
}

module.exports = Object.freeze({
    getMasterKey,
    getEnv,
    setEnv,
    deleteEnv,
    validateKey
});
