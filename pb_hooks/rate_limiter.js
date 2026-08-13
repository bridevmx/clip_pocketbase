// pb_hooks/rate_limiter.js
/**
 * In-Memory Rate Limiter Module for PocketBase v0.23+
 *
 * NOTE & LIMITATION:
 * This rate limiter maintains state in memory within the current JSVM instance.
 * It is effective for single-node deployments. In multi-node / clustered environments,
 * a distributed store (like Redis or API gateway rate limiting) should be used.
 */

var _windows = {};
var MAX_WINDOW_ENTRIES = 10000;

/**
 * Removes expired windows from memory.
 */
function cleanup() {
    var now = Date.now();
    var keys = Object.keys(_windows);
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (_windows[key] && now >= _windows[key].resetAt) {
            delete _windows[key];
        }
    }
}

/**
 * Ensures memory pool does not overflow past MAX_WINDOW_ENTRIES.
 */
function cleanupIfNeeded() {
    var keys = Object.keys(_windows);
    if (keys.length > MAX_WINDOW_ENTRIES) {
        cleanup();
        // If still exceeding after expired cleanup, clear oldest entries
        var remainingKeys = Object.keys(_windows);
        if (remainingKeys.length > MAX_WINDOW_ENTRIES) {
            _windows = {}; // Hard reset under memory pressure
        }
    }
}

/**
 * Checks if a request key is within rate limits.
 * @param {string} key - Identifier (e.g. IP + endpoint)
 * @param {number} maxRequests - Allowed requests per window
 * @param {number} windowMs - Window duration in milliseconds
 * @returns {{allowed: boolean, remaining: number, resetAt: number}}
 */
function checkLimit(key, maxRequests, windowMs) {
    if (!key || typeof key !== "string") {
        key = "unknown";
    }

    cleanupIfNeeded();

    var now = Date.now();
    if (!_windows[key]) {
        _windows[key] = { count: 0, resetAt: now + windowMs };
    }

    var window = _windows[key];
    if (now >= window.resetAt) {
        window.count = 0;
        window.resetAt = now + windowMs;
    }

    window.count++;
    var remaining = Math.max(0, maxRequests - window.count);
    var allowed = window.count <= maxRequests;

    return {
        allowed: allowed,
        remaining: remaining,
        resetAt: window.resetAt
    };
}

module.exports = {
    checkLimit: checkLimit,
    cleanup: cleanup
};
