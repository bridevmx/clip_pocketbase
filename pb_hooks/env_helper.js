// pb_hooks/env_helper.js
/**
 * Secure Environment Variable & Envelope Encryption (Key Wrapping) Helper for PocketBase v0.23+
 * Reads and writes encrypted configuration settings stored in DB or system environment.
 * Protects 124-character Master Encryption Key ($K_M$) using envelope encryption ($K_S$).
 */

const COLLECTION_SETTINGS = "z_system_settings_do_not_touch";
const MIN_KEY_LENGTH = 32;
const DEFAULT_KEY_LENGTH = 124;
const KEY_FILE_NAME = ".encryption_key";

/**
 * Retrieves the superuser security key ($K_S$) from environment variables or global memory state.
 * @returns {string|null}
 */
function getSecurityKey() {
    const envSec = $os.getenv("SECURITY_KEY") || $os.getenv("ENCRYPTION_SECURITY_KEY");
    if (envSec && envSec.trim() !== "") {
        return envSec.trim();
    }
    if (typeof globalThis.__SYSTEM_SECURITY_KEY__ === "string" && globalThis.__SYSTEM_SECURITY_KEY__.trim() !== "") {
        return globalThis.__SYSTEM_SECURITY_KEY__.trim();
    }
    return null;
}

/**
 * Resolves the path to .encryption_key inside PocketBase dataDir.
 * @returns {string}
 */
function getKeyFilePath() {
    return `${$app.dataDir()}/${KEY_FILE_NAME}`;
}

/**
 * Retrieves or generates the master key ($K_M$).
 * 1. Checks in-memory cached master key.
 * 2. Checks file ${$app.dataDir()}/.encryption_key.
 *    - If wrapped JSON { version: 1, wrapped: true, ciphertext: "..." }:
 *      Decrypts using $K_S$. If successful, caches and returns $K_M$.
 *      If $K_S$ is missing or invalid, throws a vault locked error.
 *    - If corrupt JSON or invalid envelope:
 *      Throws explicit corrupted file error.
 *    - If plaintext (124 chars or >= 32 chars):
 *      If $K_S$ is present, auto-wraps key by encrypting with $K_S$ and overwrites file in JSON format (0o600).
 *      Caches and returns $K_M$.
 * 3. Checks $os.getenv("ENCRYPTION_KEY") as legacy fallback (only if file missing).
 * 4. If file missing and no env var:
 *    Generates fresh 124-char key. Wraps if $K_S$ exists, otherwise writes plaintext (0o600).
 *    Caches and returns $K_M$.
 * @returns {string}
 */
function getMasterKey() {
    if (typeof globalThis.__SYSTEM_MASTER_KEY__ === "string" && globalThis.__SYSTEM_MASTER_KEY__.length >= MIN_KEY_LENGTH) {
        return globalThis.__SYSTEM_MASTER_KEY__;
    }

    const keyPath = getKeyFilePath();
    const securityKey = getSecurityKey();
    let fileContent = null;

    try {
        const raw = $os.readFile(keyPath);
        if (raw) {
            fileContent = String(raw).trim();
        }
    } catch (_) {
        // File does not exist or read failed
    }

    if (fileContent) {
        // Check if file is JSON formatted envelope key
        if (fileContent.startsWith("{")) {
            let jsonObj = null;
            try {
                jsonObj = JSON.parse(fileContent);
            } catch (parseErr) {
                throw new Error(`Corrupted encryption key file: Invalid JSON format (${parseErr.message})`);
            }

            if (!jsonObj || jsonObj.wrapped !== true || !jsonObj.ciphertext || typeof jsonObj.ciphertext !== "string") {
                throw new Error("Corrupted encryption key file: Missing or invalid wrapped ciphertext envelope.");
            }

            if (!securityKey) {
                throw new Error("Vault is locked: Security key ($K_S$) is required to decrypt the master key.");
            }
            let decrypted = null;
            try {
                decrypted = $security.decrypt(jsonObj.ciphertext, securityKey);
            } catch (decErr) {
                throw new Error("Vault is locked: Invalid or incorrect security key.");
            }
            if (!decrypted || decrypted.length < MIN_KEY_LENGTH) {
                throw new Error("Vault is locked: Decrypted master key is invalid or corrupted.");
            }
            globalThis.__SYSTEM_MASTER_KEY__ = decrypted;
            return decrypted;
        }

        // Plaintext key file content
        if (fileContent.length >= MIN_KEY_LENGTH) {
            const masterKey = fileContent;
            if (securityKey) {
                try {
                    const ciphertext = $security.encrypt(masterKey, securityKey);
                    const envelopeJson = JSON.stringify({
                        version: 1,
                        wrapped: true,
                        ciphertext: ciphertext
                    });
                    $os.writeFile(keyPath, envelopeJson, 0o600);
                } catch (wrapErr) {
                    console.log("[ENV HELPER WARNING] Failed to auto-wrap plaintext key:", wrapErr.message);
                }
            }
            globalThis.__SYSTEM_MASTER_KEY__ = masterKey;
            return masterKey;
        }

        // File exists but is shorter than MIN_KEY_LENGTH
        throw new Error("Corrupted encryption key file: Key length is shorter than minimum required 32 characters.");
    }

    // Check $os.getenv("ENCRYPTION_KEY") as legacy fallback only when file does not exist
    const legacyEnvKey = $os.getenv("ENCRYPTION_KEY");
    if (legacyEnvKey && legacyEnvKey.length >= MIN_KEY_LENGTH && !securityKey) {
        globalThis.__SYSTEM_MASTER_KEY__ = legacyEnvKey;
        return legacyEnvKey;
    }

    // File missing or invalid — generate fresh master key
    const newMasterKey = $security.randomString(DEFAULT_KEY_LENGTH);
    try {
        if (securityKey) {
            const ciphertext = $security.encrypt(newMasterKey, securityKey);
            const envelopeJson = JSON.stringify({
                version: 1,
                wrapped: true,
                ciphertext: ciphertext
            });
            $os.writeFile(keyPath, envelopeJson, 0o600);
        } else {
            $os.writeFile(keyPath, newMasterKey, 0o600);
        }
    } catch (writeErr) {
        console.log("[ENV HELPER ERROR] Failed to write .encryption_key file:", writeErr.message);
    }

    globalThis.__SYSTEM_MASTER_KEY__ = newMasterKey;
    return newMasterKey;
}

/**
 * Unlocks the vault by providing a security key ($K_S$).
 * Decrypts $K_M$, caches $K_S$ and $K_M$ in memory on success.
 * @param {string} securityKey
 * @returns {boolean}
 */
function unlockVault(securityKey) {
    if (!securityKey || typeof securityKey !== "string" || securityKey.trim() === "") {
        throw new Error("Security key must be a non-empty string.");
    }
    const cleanSecKey = securityKey.trim();

    const prevSecKey = globalThis.__SYSTEM_SECURITY_KEY__;
    const prevMasterKey = globalThis.__SYSTEM_MASTER_KEY__;

    globalThis.__SYSTEM_SECURITY_KEY__ = cleanSecKey;
    globalThis.__SYSTEM_MASTER_KEY__ = null;

    try {
        const masterKey = getMasterKey();
        if (masterKey && masterKey.length >= MIN_KEY_LENGTH) {
            return true;
        }
        throw new Error("Failed to retrieve valid master key after unlock.");
    } catch (err) {
        globalThis.__SYSTEM_SECURITY_KEY__ = prevSecKey;
        globalThis.__SYSTEM_MASTER_KEY__ = prevMasterKey;
        throw err;
    }
}

/**
 * Wraps (encrypts) the master key ($K_M$) using a passphrase/security key ($K_S$).
 * Writes wrapped JSON format to .encryption_key with 0o600 permissions.
 * @param {string} securityKey
 * @returns {boolean}
 */
function wrapVault(securityKey) {
    if (!securityKey || typeof securityKey !== "string" || securityKey.trim() === "") {
        throw new Error("Security key must be a non-empty string.");
    }
    const cleanSecKey = securityKey.trim();

    const vaultStatus = getVaultStatus();
    if (vaultStatus.wrapped && vaultStatus.locked) {
        throw new Error("Cannot wrap vault: Vault is currently locked. Please unlock it first.");
    }

    let masterKey = null;
    try {
        masterKey = getMasterKey();
    } catch (err) {
        if (vaultStatus.wrapped || (err.message && err.message.startsWith("Vault is locked"))) {
            throw new Error("Cannot wrap vault: Vault is currently locked. Please unlock it first.");
        }
        throw err;
    }

    if (!masterKey || masterKey.length < MIN_KEY_LENGTH) {
        masterKey = $security.randomString(DEFAULT_KEY_LENGTH);
    }

    const ciphertext = $security.encrypt(masterKey, cleanSecKey);
    const envelopeJson = JSON.stringify({
        version: 1,
        wrapped: true,
        ciphertext: ciphertext
    });

    const keyPath = getKeyFilePath();
    $os.writeFile(keyPath, envelopeJson, 0o600);

    globalThis.__SYSTEM_SECURITY_KEY__ = cleanSecKey;
    globalThis.__SYSTEM_MASTER_KEY__ = masterKey;

    return true;
}

/**
 * Gets status of the encryption key vault.
 * @returns {{ wrapped: boolean, locked: boolean, has_env_key: boolean }}
 */
function getVaultStatus() {
    const keyPath = getKeyFilePath();
    let fileExists = false;
    let isWrapped = false;
    let isLocked = false;

    try {
        const raw = $os.readFile(keyPath);
        if (raw) {
            fileExists = true;
            const content = String(raw).trim();
            if (content.startsWith("{") && content.endsWith("}")) {
                const jsonObj = JSON.parse(content);
                if (jsonObj && jsonObj.wrapped === true) {
                    isWrapped = true;
                }
            }
        }
    } catch (_) {}

    const hasEnv = fileExists || Boolean($os.getenv("ENCRYPTION_KEY")) || Boolean($os.getenv("SECURITY_KEY")) || Boolean($os.getenv("ENCRYPTION_SECURITY_KEY"));

    if (isWrapped) {
        try {
            getMasterKey();
            isLocked = false;
        } catch (_) {
            isLocked = true;
        }
    } else {
        isLocked = false;
    }

    return {
        wrapped: isWrapped,
        locked: isLocked,
        has_env_key: hasEnv
    };
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
                    console.log("[ENV HELPER ERROR] Failed to decrypt setting for key:", key, "-", decErr.message);
                    return null;
                }
            }
            return rawValue;
        }
    } catch (err) {
        console.log("[ENV HELPER ERROR] DB lookup failed for key:", key, "-", err.message);
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
    unlockVault,
    wrapVault,
    getVaultStatus,
    validateKey
});
