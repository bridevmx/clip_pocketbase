/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// GET /api/clip/transaction/{receiptNo} — Get transaction by receipt number
// GET /api/clip/transactions          — List transactions by date range
//
// Both endpoints require authentication (not necessarily superuser).
// ─────────────────────────────────────────────────────────────────────────

// ─── GET /api/clip/transaction/{receiptNo} ──────────────────────────────────

routerAdd("GET", "/api/clip/transaction/{receiptNo}", (e) => {
  const clip = require(`${__hooks}/clip_api_client.js`);
  const receiptNo = e.request.params.receiptNo;

  if (!receiptNo) {
    throw new BadRequestError("receipt_no is required");
  }

  var result;
  try {
    result = clip.getTransaction(receiptNo);
  } catch (err) {
    $app.logger().error("[CLIP TRANSACTIONS] API call failed", "error", err.message);
    throw new InternalServerError("Could not fetch transaction");
  }

  if (result.statusCode === 404) {
    throw new NotFoundError("Transaction not found");
  }

  if (result.statusCode < 200 || result.statusCode > 299) {
    throw new InternalServerError("Clip API error");
  }

  var tx = result.data;
  return e.json(200, {
    receipt_no: tx.receipt_no,
    date: tx.date,
    status: tx.status,
    amount: tx.amount,
    currency: tx.currency,
    payment_method: tx.payment_method,
    card_brand: tx.card ? tx.card.brand : null,
    card_last4: tx.card ? tx.card.last4 : null,
    tip: tx.tip || 0,
  });
});

// ─── GET /api/clip/transactions ─────────────────────────────────────────────

routerAdd("GET", "/api/clip/transactions", (e) => {
  const clip = require(`${__hooks}/clip_api_client.js`);
  const query = e.requestInfo().query;

  const from = query.from;
  const to = query.to;
  const page = parseInt(query.page || "1");
  const perPage = parseInt(query.per_page || "50");

  if (!from || !to) {
    throw new BadRequestError("from and to query parameters are required (YYYY-MM-DD)");
  }

  // Validate date format
  var dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(from) || !dateRegex.test(to)) {
    throw new BadRequestError("Dates must be in YYYY-MM-DD format");
  }

  var result;
  try {
    result = clip.listTransactions(from, to, page, perPage);
  } catch (err) {
    $app.logger().error("[CLIP TRANSACTIONS] API call failed", "error", err.message);
    throw new InternalServerError("Could not fetch transactions");
  }

  if (result.statusCode < 200 || result.statusCode > 299) {
    throw new InternalServerError("Clip API error");
  }

  return e.json(200, {
    transactions: result.data.transactions || [],
    total: result.data.total || 0,
    page: page,
    per_page: perPage,
    has_more: (result.data.transactions || []).length === perPage,
  });
});
