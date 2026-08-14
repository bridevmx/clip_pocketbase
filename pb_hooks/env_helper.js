// pb_hooks/env_helper.js
/**
 * Simple & Secure Environment Variable Helper for PocketBase v0.23+
 * Reads and writes encrypted configuration settings stored in DB or system environment.
 * Uses a single master ENCRYPTION_KEY (from OS environment or auto-generated 124-char key in pb_data/.encryption_key).
 */

const COLLECTION_SETTINGS = "z_system_settings_do_not_touch";
const MIN_KEY_LENGTH = 32;
const DEFAULT_KEY_LENGTH = 124;

/**
 * Retrieves the master encryption key.
 * 1. Checks $os.getenv("ENCRYPTION_KEY") (if defined and >= 32 chars).
 * 2. Checks persistent file ${$app.dataDir()}/.encryption_key.
 * 3. If missing, auto-generates a 124-character cryptographic key and persists to disk (0o600).
 * @returns {string}
 */
function getMasterKey() {
    const envKey = $os.getenv("ENCRYPTION_KEY");
    if (envKey && envKey.trim().length >= MIN_KEY_LENGTH) {
        return envKey.trim();
    }

    const keyPath = `${$app.dataDir()}/.encryption_key`;
    try {
        const raw = $os.readFile(keyPath);
        if (raw) {
            const keyStr = String(raw).trim();
            if (keyStr.length >= MIN_KEY_LENGTH) {
                return keyStr;
            }
        }
    } catch (_) {
        // File does not exist or read failed
    }

    const autoKey = $security.randomString(DEFAULT_KEY_LENGTH);
    try {
        $os.writeFile(keyPath, autoKey, 0o600);
    } catch (writeErr) {
        console.log("[ENV HELPER ERROR] Could not save .encryption_key:", writeErr.message);
    }
    return autoKey;
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
 * Derives a valid 32-character AES-256 key from any raw master key.
 * PocketBase $security.encrypt / $security.decrypt requires the key to be EXACTLY 32 bytes.
 * Using SHA-256 hex string guarantees 100% pure ASCII single-byte characters.
 * @param {string} rawKey
 * @returns {string} Exactly 32 ASCII characters
 */
function derive32ByteKey(rawKey) {
    if (!rawKey || typeof rawKey !== "string") {
        throw new Error("Encryption key must be a non-empty string.");
    }
    const trimmed = rawKey.trim();
    if (trimmed.length === 0) {
        throw new Error("Encryption key cannot be empty.");
    }
    // $security.sha256(trimmed) returns a 64-character hex string.
    // The first 32 characters form a deterministic 32-byte key suitable for AES-256.
    return $security.sha256(trimmed).substring(0, 32);
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
                    const aesKey = derive32ByteKey(masterKey);
                    return $security.decrypt(rawValue, aesKey);
                } catch (decErr) {
                    console.log("[ENV HELPER ERROR] Failed to decrypt setting for key:", key, decErr.message);
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
        const aesKey = derive32ByteKey(masterKey);
        valueToSave = $security.encrypt(stringVal, aesKey);
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
    derive32ByteKey,
    getEnv,
    setEnv,
    deleteEnv,
    validateKey
});
