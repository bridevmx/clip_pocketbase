/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// Clip API client helper — shared by all clip_*.pb.js hooks.
//
// NOTE: PocketBase's JS runtime (Goja) does not provide the browser's
// btoa() global. Base64 encoding must be done via Buffer (available in
// PocketBase v0.23+). This module centralises that concern so no other
// file needs to know about it.
// ─────────────────────────────────────────────────────────────────────────

const CLIP_API_BASE_URL = "https://api.payclip.com";

/**
 * Returns the Basic Auth header value for the Clip API.
 *
 * CLIP_API_KEY must be set to the pre-encoded Base64 token exactly as
 * provided by Clip — i.e. base64("CLAVE_API:CLAVE_SECRETA") — and is
 * used verbatim in the Authorization header. No re-encoding is done here.
 *
 * @returns {string}  "Basic <CLIP_API_KEY>"
 */
function clipBasicAuthHeader() {
  const token = $os.getenv("CLIP_API_KEY");
  if (!token) {
    throw new Error("CLIP_API_KEY environment variable is not configured");
  }
  return "Basic " + token;
}

/**
 * Sends an authenticated HTTP request to the Clip API.
 *
 * @param {"GET"|"POST"} method
 * @param {string} path   — e.g. "/v1/checkout" or "/v1/checkout/{id}"
 * @param {object|null} payload  — request body (serialised to JSON), or null
 * @param {number} timeoutSeconds
 * @returns {object}  parsed JSON response body
 * @throws  {Error}   on non-2xx status or missing env var
 */
function clipApiRequest(method, path, payload, timeoutSeconds) {
  const authHeader = clipBasicAuthHeader();

  const requestOptions = {
    method: method,
    url: CLIP_API_BASE_URL + path,
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    timeout: timeoutSeconds || 15,
  };

  if (payload !== null && payload !== undefined) {
    requestOptions.body = JSON.stringify(payload);
  }

  const res = $http.send(requestOptions);

  if (res.statusCode < 200 || res.statusCode > 299) {
    throw new Error(
      "Clip API error " + res.statusCode + " on " + method + " " + path + ": " + res.raw
    );
  }

  return res.json;
}
