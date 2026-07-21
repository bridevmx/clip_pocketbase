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

/**
 * Maps a raw Clip v2 status to one of the allowed DB select values.
 *
 * v2 GET /checkout/{id} returns status with CHECKOUT_ prefix:
 *   CHECKOUT_CREATED    → CREATED
 *   CHECKOUT_PENDING    → PENDING
 *   CHECKOUT_COMPLETED  → COMPLETED
 *   CHECKOUT_CANCELED   → CANCELED
 *   CHECKOUT_EXPIRED    → EXPIRED
 *
 * v1 / webhook resource_status values kept for compatibility:
 *   CREATED / PENDING / COMPLETED / CANCELED / EXPIRED
 *
 * @param {string} raw
 * @returns {"CREATED"|"PENDING"|"COMPLETED"|"CANCELED"|"EXPIRED"}
 */
function normaliseClipStatus(raw) {
  const ALLOWED = {
    CHECKOUT_CREATED:   "CREATED",
    CHECKOUT_PENDING:   "PENDING",
    CHECKOUT_COMPLETED: "COMPLETED",
    CHECKOUT_CANCELED:  "CANCELED",
    CHECKOUT_CANCELLED: "CANCELED",
    CHECKOUT_EXPIRED:   "EXPIRED",
    CREATED:   "CREATED",
    PENDING:   "PENDING",
    COMPLETED: "COMPLETED",
    CANCELED:  "CANCELED",
    CANCELLED: "CANCELED",
    EXPIRED:   "EXPIRED",
  };

  const upper = (raw || "").toString().toUpperCase().trim();
  const mapped = ALLOWED[upper];

  if (!mapped) {
    $app.logger().warn(
      "Clip webhook: unknown status received, defaulting to PENDING",
      "raw_status", raw
    );
    return "PENDING";
  }

  return mapped;
}

// ─── REFUND ─────────────────────────────────────────────────────────────────

/**
 * Requests a refund for a completed transaction.
 *
 * Clip API: POST /refunds
 * @param {string} receiptNo   — Clip receipt number (e.g. "PuGCZDqV")
 * @param {number|null} amount — Amount to refund in MXN (null = full refund)
 * @param {string} reason      — Reason for the refund
 * @returns {{ data: object, statusCode: number }}
 */
function clipRefund(receiptNo, amount, reason) {
  const payload = { receipt_no: receiptNo };
  if (amount !== null && amount !== undefined) {
    payload.amount = amount;
  }
  if (reason) {
    payload.reason = reason;
  }
  return clipApiRequest("POST", "/refunds", payload, 20);
}

// ─── TRANSACTIONS ───────────────────────────────────────────────────────────

/**
 * Retrieves transaction details by receipt number.
 *
 * Clip API: GET /transactions/{receipt_no}
 * @param {string} receiptNo — Clip receipt number
 * @returns {{ data: object, statusCode: number }}
 */
function clipGetTransaction(receiptNo) {
  return clipApiRequest("GET", "/transactions/" + receiptNo, null, 15);
}

/**
 * Lists transactions within a date range (max 30 days).
 *
 * Clip API: GET /transactions?from=YYYY-MM-DD&to=YYYY-MM-DD
 * @param {string} from    — Start date YYYY-MM-DD
 * @param {string} to      — End date YYYY-MM-DD
 * @param {number} page    — Page number (default: 1)
 * @param {number} perPage — Records per page (default: 50)
 * @returns {{ data: object, statusCode: number }}
 */
function clipListTransactions(from, to, page, perPage) {
  // Validate 30-day range
  var fromDate = new Date(from);
  var toDate = new Date(to);
  var diffMs = toDate.getTime() - fromDate.getTime();
  var diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays > 30) {
    return {
      data: { error: "RANGE_EXCEEDED", message: "Date range cannot exceed 30 days" },
      statusCode: 400,
    };
  }

  var params = "from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to);
  if (page) params += "&page=" + encodeURIComponent(page.toString());
  if (perPage) params += "&per_page=" + encodeURIComponent(perPage.toString());

  return clipApiRequest("GET", "/transactions?" + params, null, 20);
}

// ─── EXPORTS ────────────────────────────────────────────────────────────────

module.exports = {
  request: clipApiRequest,
  normaliseClipStatus: normaliseClipStatus,
  refund: clipRefund,
  getTransaction: clipGetTransaction,
  listTransactions: clipListTransactions,

  // Clip v2 error code constants for callers.
  ERR_FORMAT:    "002", // Format validation error — bad input
  ERR_NOT_FOUND: "021", // Payment Request ID doesn't exist

  // Refund error constants.
  REFUND_ERRORS: {
    INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
    REFUND_NOT_ALLOWED:   "REFUND_NOT_ALLOWED",
    TRANSACTION_NOT_FOUND: "TRANSACTION_NOT_FOUND",
  },
};
