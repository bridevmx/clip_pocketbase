/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// POST /api/spei/report-payment — Report a SPEI payment and trigger CEP validation.
//
// The user calls this endpoint after making a SPEI transfer.
// It updates the order status to REPORTED and triggers automatic CEP validation.
//
// Request body:
//   order_id        (required) — The spei_orders record ID
//   criterio        (required) — Reference (7 chars) or tracking code (8-30 chars)
//   emisor          (required) — Issuing bank code (e.g. "40012")
//   monto_declarado (required) — Declared amount
//
// Response (success):
//   { ok, status, message }
// ─────────────────────────────────────────────────────────────────────────

routerAdd("POST", "/api/spei/report-payment", (e) => {
  const spei = require(`${__hooks}/spei_api_client.js`);
  const info = e.requestInfo();
  const body = info.body;

  const orderId = body["order_id"];
  const criterio = body["criterio"];
  const emisor = body["emisor"];
  const montoDeclarado = body["monto_declarado"];

  if (!orderId || !criterio || !emisor || !montoDeclarado) {
    throw new BadRequestError("order_id, criterio, emisor and monto_declarado are required");
  }

  // Validate criterio length
  var criterioType = spei.detectCriterioType(criterio);
  if (!criterioType) {
    throw new BadRequestError("criterio must be 7 characters or between 8 and 30 characters");
  }

  // Find the order
  let order;
  try {
    order = $app.findRecordById("spei_orders", orderId);
  } catch (_) {
    throw new NotFoundError("Order not found");
  }

  // Validate order status
  var currentStatus = order.getString("status");
  if (currentStatus !== "PENDING") {
    throw new BadRequestError("Order must be in PENDING status to report payment");
  }

  // ─── SECURITY CHECK 1: Order expiration (24h) ──────────────────────────
  var created = new Date(order.getDate("created"));
  var now = new Date();
  var diffHours = (now - created) / (1000 * 60 * 60);
  if (diffHours > 24) {
    throw new BadRequestError("Order has expired (older than 24 hours)");
  }

  // ─── SECURITY CHECK 2: Validate declared amount ────────────────────────
  var orderAmount = order.getFloat("amount");
  var declared = parseFloat(montoDeclarado);
  if (isNaN(declared) || declared <= 0) {
    throw new BadRequestError("Invalid declared amount");
  }
  if (declared < orderAmount) {
    throw new BadRequestError("Declared amount is less than order amount");
  }
  // Allow 10% tolerance for bank fees
  if (declared > orderAmount * 1.1) {
    throw new BadRequestError("Declared amount exceeds order amount");
  }

  // ─── SECURITY CHECK 3: Check for CEP reuse ─────────────────────────────
  // Same tracking code + amount + account should not be used twice
  var existingCep;
  try {
    existingCep = $app.findRecordsByFilter(
      "cep_verifications",
      `tracking_code="${criterio}" && amount=${declared}`,
      "", 1, 0
    );
  } catch (_) {
    existingCep = [];
  }
  if (existingCep && existingCep.length > 0) {
    $app.logger().warn("[SPEI SECURITY] CEP reuse attempt", {
      "order_id": orderId,
      "criterio": criterio,
      "amount": declared,
      "existing_cep_id": existingCep[0].id,
    });
    throw new BadRequestError("This payment has already been reported for another order");
  }

  // Get bank name for emisor
  var emisorName = "";
  try {
    var emisorBank = $app.findRecordsByFilter("spei_banks", `bank_code="${emisor}"`, "", 1, 0);
    if (emisorBank && emisorBank.length > 0) {
      emisorName = emisorBank[0].getString("bank_name");
    }
  } catch (_) {}

  // Update order with payment details
  order.set("criterio", criterio);
  order.set("emisor", emisor);
  order.set("emisor_name", emisorName);
  order.set("monto_declarado", String(montoDeclarado));
  order.set("submitted_at", new Date().toISOString());
  order.set("status", "REPORTED");
  $app.save(order);

  $app.logger().info(
    "[SPEI] Payment reported",
    "order_id", orderId,
    "criterio", criterio,
    "emisor", emisor
  );

  // ─── Trigger automatic CEP validation ──────────────────────────────────
  var receptorData = spei.resolveReceptorFromOrder($app, order);

  // Format date for CEP (DD-MM-YYYY)
  var fecha = spei.formatCepDate(new Date());

  // Call CEP validation
  var cepResult;
  try {
    cepResult = spei.validate(fecha, criterio, emisor, receptorData.receptor, receptorData.cuenta, String(montoDeclarado));
  } catch (err) {
    $app.logger().error("[SPEI] CEP validation error", "error", err.message);
    return e.json(200, {
      ok: true,
      status: "REPORTED",
      message: "Payment reported. CEP validation will be retried automatically.",
    });
  }

  // Create cep_verification record
  var cepCol = $app.findCollectionByNameOrId("cep_verifications");
  var cepRec = new Record(cepCol);
  cepRec.set("order", order.id);
  cepRec.set("reference", cepResult.data.reference || null);
  cepRec.set("tracking_code", cepResult.data.trackingCode || null);
  cepRec.set("issuing_bank", cepResult.data.issuingBank || null);
  cepRec.set("receiving_bank", cepResult.data.receivingBank || null);
  cepRec.set("status_name", cepResult.data.statusName || cepResult.data.status || null);
  cepRec.set("status_description", cepResult.data.statusDescription || null);
  cepRec.set("reception_date", cepResult.data.receptionDate || null);
  cepRec.set("processing_date", cepResult.data.processingDate || null);
  cepRec.set("beneficiary_account", cepResult.data.beneficiaryAccount || null);
  cepRec.set("amount", cepResult.data.amount ? parseFloat(cepResult.data.amount) : null);
  cepRec.set("raw_response", cepResult.data);
  $app.save(cepRec);

  // ─── Evaluate CEP result using shared logic ────────────────────────────
  var evaluation = spei.evaluateCepResult(cepResult.data, String(montoDeclarado), receptorData.cuenta);

  if (evaluation.shouldRetry) {
    // Schedule retry
    var retryCount = (order.getInt("retry_count") || 0) + 1;
    order.set("retry_count", retryCount);

    if (retryCount >= 12) {
      // Too many retries — escalate to manual review
      order.set("status", "MANUAL_REVIEW");
      order.set("validated_at", new Date().toISOString());
      $app.save(order);

      cepRec.set("validated_match", false);
      cepRec.set("mismatch_reason", "Maximum retries reached");
      $app.save(cepRec);

      return e.json(200, {
        ok: true,
        status: "MANUAL_REVIEW",
        message: "Transfer still in process after multiple retries. Escalated to manual review.",
      });
    }

    // Schedule next retry (5 minutes)
    order.set("next_retry_at", new Date(Date.now() + 5 * 60 * 1000).toISOString());
    $app.save(order);

    return e.json(200, {
      ok: true,
      status: "REPORTED",
      message: "Transfer in process. Will retry in 5 minutes (attempt " + retryCount + "/12).",
    });
  }

  // Update order based on evaluation result
  order.set("validated_at", new Date().toISOString());
  order.set("status", evaluation.newStatus);
  order.set("next_retry_at", null);
  $app.save(order);

  cepRec.set("validated_match", evaluation.isMatch);
  if (!evaluation.isMatch) {
    cepRec.set("mismatch_reason", evaluation.reason);
  }
  $app.save(cepRec);

  if (evaluation.isMatch) {
    $app.logger().info("[SPEI] Order LIQUIDADO", "order_id", orderId);

    return e.json(200, {
      ok: true,
      status: "LIQUIDADO",
      message: "CEP validated successfully. Payment confirmed.",
    });
  }

  return e.json(200, {
    ok: true,
    status: evaluation.newStatus,
    message: "CEP validation failed: " + evaluation.reason,
  });
});
