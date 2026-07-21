/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// Clip API client — CommonJS module, shared via require().
//
// Usage in any pb_hooks/*.pb.js file:
//   const clip = require(`${__hooks}/clip_api_client.js`);
//   const data = clip.request("POST", "/v2/checkout", payload, 20);
//
// NOTE: This file does NOT use the .pb.js extension on purpose — PocketBase
// only auto-executes *.pb.js files as hooks. This file is a plain module
// loaded explicitly via require() to share scope correctly across hooks.
// ─────────────────────────────────────────────────────────────────────────

const CLIP_API_BASE_URL = "https://api.payclip.com";

/**
 * Returns the Basic Auth header value for the Clip API.
 *
 * CLIP_API_KEY accepts either format from the Clip dashboard:
 *   - Full header:  "Basic NjQyZmYx..."  (as shown in the Clip token generator)
 *   - Token only:   "NjQyZmYx..."        (just the Base64 part)
 *
 * If the value already starts with "Basic " it is used verbatim.
 * Otherwise "Basic " is prepended automatically.
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
 * @param {"GET"|"POST"} method
 * @param {string} path          — e.g. "/v2/checkout" or "/v2/checkout/{id}"
 * @param {object|null} payload  — request body (serialised to JSON), or null
 * @param {number} timeoutSeconds
 * @returns {object}  parsed JSON response body
 * @throws  {Error}   on non-2xx status or missing env var
 */
function clipApiRequest(method, path, payload, timeoutSeconds) {
  const authHeader = clipBasicAuthHeader();

  // DEBUG — visible in PocketHost instance logs.
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

  if (res.statusCode < 200 || res.statusCode > 299) {
    throw new Error(
      "Clip API error " + res.statusCode + " on " + method + " " + path + ": " + res.raw
    );
  }

  return res.json;
}

module.exports = {
  request: clipApiRequest,
};
