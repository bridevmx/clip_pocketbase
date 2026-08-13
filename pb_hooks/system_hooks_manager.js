// pb_hooks/system_hooks_manager.js
/**
 * Dynamic Hooks Manager for PocketBase v0.23+
 * Provides validation, disk writing, and synchronization of dynamic .pb.js hooks.
 */

const MAX_HOOK_SIZE = 524288; // 512 KB

/**
 * Validates hook filename strictly.
 * Only allows [a-zA-Z0-9_-]+.pb.js (max 128 chars).
 * Prevents path traversal, null bytes, and hidden files.
 * @param {string} filename
 */
function validateFilename(filename) {
    if (!filename || typeof filename !== "string" || filename.length > 128) {
        throw new BadRequestError("Filename must be a string under 128 characters.");
    }
    if (!/^[a-zA-Z0-9_-]+\.pb\.js$/.test(filename)) {
        throw new BadRequestError("Invalid filename format. Must be alphanumeric (plus _ or -) and end with '.pb.js'.");
    }
}

/**
 * Validates hook JS content syntax and size limit.
 * @param {string} content
 */
function validateContent(content) {
    if (content === undefined || content === null || typeof content !== "string") {
        throw new BadRequestError("Hook content must be a non-null string.");
    }
    if (content.length > MAX_HOOK_SIZE) {
        throw new BadRequestError("Hook content exceeds maximum size of 512KB.");
    }
    // Basic syntax check using JSVM Function parser
    try {
        new Function(content);
    } catch (syntaxErr) {
        throw new BadRequestError("JavaScript syntax validation failed: " + syntaxErr.message);
    }
}

/**
 * Safely resolves hook file path within __hooks directory.
 * @param {string} filename
 * @returns {string}
 */
function resolveHookPath(filename) {
    validateFilename(filename);
    return `${__hooks}/${filename}`;
}

/**
 * Writes hook code to disk in the __hooks directory.
 * @param {string} filename
 * @param {string} content
 */
function writeHookToDisk(filename, content) {
    validateContent(content);
    const filePath = resolveHookPath(filename);
    $os.writeFile(filePath, content, 0o644);
}

/**
 * Removes hook file from disk.
 * @param {string} filename
 */
function removeHookFromDisk(filename) {
    const filePath = resolveHookPath(filename);
    try {
        $os.remove(filePath);
    } catch (_) {
        // File might not exist on disk
    }
}

/**
 * Syncs a DB record state to disk.
 * If active is true, writes content to disk; if false, removes file from disk.
 * @param {object} record - Record from z_system_hooks_do_not_touch
 */
function syncHookFromRecord(record) {
    if (!record) return;
    const filename = record.getString("filename");
    const content = record.getString("content");
    const active = record.getBool("active");

    try {
        validateFilename(filename);
        if (active) {
            validateContent(content);
            writeHookToDisk(filename, content);
        } else {
            removeHookFromDisk(filename);
        }
    } catch (err) {
        console.log("[HOOKS MANAGER ERROR] Sync failed for record filename:", filename, "-", err.message);
    }
}

module.exports = Object.freeze({
    validateFilename,
    validateContent,
    resolveHookPath,
    writeHookToDisk,
    removeHookFromDisk,
    syncHookFromRecord
});
