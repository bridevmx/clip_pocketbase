// pb_hooks/rate_limiter.js
// In-memory rate limiter for PocketBase JSVM.
// Uses a sliding window counter per IP address.
// NOTE: Resets on PocketBase restart. Not suitable for distributed deployments.

var _windows = {};

/**
 * Checks if the given key (IP address) has exceeded the rate limit.
 * Uses a sliding window of `windowMs` milliseconds.
 *
 * @param {string} key - Usually the client IP address
 * @param {number} maxRequests - Max allowed requests in the window
 * @param {number} windowMs - Window size in milliseconds
 * @returns {{ allowed: boolean, remaining: number, resetAt: number }}
 */
function checkLimit(key, maxRequests, windowMs) {
  var now = Date.now();
  var windowKey = key;
  
  if (!_windows[windowKey]) {
    _windows[windowKey] = { count: 0, resetAt: now + windowMs };
  }
  
  var window = _windows[windowKey];
  
  // Reset window if expired
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
    resetAt: window.resetAt,
  };
}

/**
 * Cleans up expired windows to prevent memory growth.
 * Call periodically (e.g. from a cron or occasionally from a handler).
 */
function cleanup() {
  var now = Date.now();
  var keys = Object.keys(_windows);
  for (var i = 0; i < keys.length; i++) {
    if (now >= _windows[keys[i]].resetAt) {
      delete _windows[keys[i]];
    }
  }
}

module.exports = { checkLimit: checkLimit, cleanup: cleanup };
