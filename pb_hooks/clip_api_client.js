/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// Clip API client — CommonJS module, shared via require().
//
// Usage in any pb_hooks/*.pb.js file:
//   const clip = require(`${__hooks}/clip_api_client.js`);
//   const data = clip.request("POST", "/v2/checkout", payload, 20);
//
// Clip v2 error response shape:
//   { message, code_message, detail }
//
// Known error codes:
//   002 — Format validation error (bad UUID, missing required fields)
//   021 — Payment Request ID doesn't exist (valid UUID, unknown to Clip)
//   401 — access_token is expired (invalid credentials)
//
// NOTE: This file does NOT use the .pb.js extension — PocketBase only
// auto-executes *.pb.js files as hooks. This file is loaded explicitly
// via require() to share scope correctly across hooks.
// ─────────────────────────────────────────────────────────────────────────

const CLIP_API_BASE_URL = "https://api.payclip.com";

/**
 * Returns the Basic Auth header value for the Clip API.
 *
 * CLIP_API_KEY accepts either format from the Clip dashboard:
 *   - Full header:  "Basic NjQyZmYx..."  (as shown in the Clip token generator)
 *   - Token only:   "NjQyZmYx..."        (just the Base64 part)
 *
 * @returns {string}  "Basic <base64token>"
 */
function clipBasicAuthHeader() {
  const token = $os.getenv("CLIP_API_KEY");
  if (!token) {
    throw new Error("CLIP_API_KEY environment variable is not configured");
  }
  if (token.indexOf("Basic ") === 0) {
    return token;
  }
  return "Basic " + token;
}

/**
 * Sends an authenticated HTTP request to the Clip API.
 *
 * Returns { data, statusCode } on all responses.
 * Throws only on network/timeout errors or missing credentials.
 * Callers are responsible for checking statusCode.
 *
 * @param {"GET"|"POST"} method
 * @param {string} path          — e.g. "/v2/checkout" or "/v2/checkout/{id}"
 * @param {object|null} payload  — request body (serialised to JSON), or null
 * @param {number} timeoutSeconds
 * @returns {{ data: object, statusCode: number }}
 * @throws  {Error} on network error or missing CLIP_API_KEY
 */
function clipApiRequest(method, path, payload, timeoutSeconds) {
  const authHeader = clipBasicAuthHeader();

  const tokenPreview = authHeader.substring(0, 20) + "...";
  console.log("[CLIP DEBUG] " + method + " " + CLIP_API_BASE_URL + path);
  console.log("[CLIP DEBUG] Auth header prefix: " + tokenPreview);
  if (payload) {
    console.log("[CLIP DEBUG] Request body: " + JSON.stringify(payload));
  }

  const requestOptions = {
    method: method,
    url: CLIP_API_BASE_URL + path,
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    timeout: timeoutSeconds || 15,
  };

  if (payload !== null && payload !== undefined) {
    requestOptions.body = JSON.stringify(payload);
  }

  const res = $http.send(requestOptions);

  console.log("[CLIP DEBUG] Response status: " + res.statusCode);
  console.log("[CLIP DEBUG] Response body: " + res.raw);

  return {
    statusCode: res.statusCode,
    data: res.json,
  };
}

module.exports = {
  request: clipApiRequest,

  // Clip v2 error code constants for callers.
  ERR_FORMAT:    "002", // Format validation error — bad input
  ERR_NOT_FOUND: "021", // Payment Request ID doesn't exist
};
