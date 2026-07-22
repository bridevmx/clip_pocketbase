/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// POST /api/spei/validate-cep — Validate a SPEI order against Banxico CEP.
//
// This endpoint is called automatically by the retry mechanism.
// It can also be called manually by staff to force re-validation.
// Requires authentication.
//
// Request body:
//   order_id (required) — The spei_orders record ID
//
// Response (success):
//   { ok, status, message }
// ─────────────────────────────────────────────────────────────────────────

routerAdd("POST", "/api/spei/validate-cep", (e) => {
  const spei = require(`${__hooks}/spei_api_client.js`);
  const info = e.requestInfo();
  const body = info.body;

  // Require authentication (staff only)
  if (!info.auth || !info.auth.id) {
    throw new ForbiddenError("Authentication required");
  }

  const orderId = body["order_id"];

  if (!orderId) {
    throw new BadRequestError("order_id is required");
  }

  // Find the order
  let order;
  try {
    order = $app.findRecordById("spei_orders", orderId);
  } catch (_) {
    throw new NotFoundError("Order not found");
  }

  var currentStatus = order.getString("status");
  if (currentStatus === "LIQUIDADO" || currentStatus === "EXPIRED") {
    throw new BadRequestError("Order is already in terminal state: " + currentStatus);
  }

  // Get order details
  var criterio = order.getString("criterio");
  var emisor = order.getString("emisor");
  var montoDeclarado = order.getString("monto_declarado");

  if (!criterio || !emisor || !montoDeclarado) {
    throw new BadRequestError("Order missing required fields for validation (criterio, emisor, monto_declarado)");
  }

  // Resolve receptor from spei_settings
  var receptorData = spei.resolveReceptorFromOrder($app, order);

  // Format date for CEP (DD-MM-YYYY)
  var fecha = spei.formatCepDate(new Date());

  // Call CEP validation
  var cepResult;
  try {
    cepResult = spei.validate(fecha, criterio, emisor, receptorData.receptor, receptorData.cuenta, montoDeclarado);
  } catch (err) {
    $app.logger().error("[SPEI] CEP validation error", "error", err.message);
    throw new InternalServerError("CEP validation failed: " + err.message);
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

  // Set validated_by to the authenticated staff user
  cepRec.set("validated_by", info.auth.id);

  $app.save(cepRec);

  // ─── Evaluate CEP result using shared logic ────────────────────────────
  var evaluation = spei.evaluateCepResult(cepResult.data, montoDeclarado, receptorData.cuenta);

  if (evaluation.shouldRetry) {
    var retryCount = (order.getInt("retry_count") || 0) + 1;
    order.set("retry_count", retryCount);

    if (retryCount >= 12) {
      order.set("status", "MANUAL_REVIEW");
      order.set("validated_at", new Date().toISOString());
      order.set("next_retry_at", null);
      $app.save(order);

      cepRec.set("validated_match", false);
      cepRec.set("mismatch_reason", "Maximum retries reached");
      $app.save(cepRec);

      return e.json(200, {
        ok: true,
        status: "MANUAL_REVIEW",
        message: "Transfer still in process after maximum retries.",
      });
    }

    // Schedule next retry (5 minutes)
    order.set("next_retry_at", new Date(Date.now() + 5 * 60 * 1000).toISOString());
    $app.save(order);

    return e.json(200, {
      ok: true,
      status: currentStatus,
      message: "Transfer in process. Retry " + retryCount + "/12 scheduled.",
    });
  }

  // Update order
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
    return e.json(200, {
      ok: true,
      status: "LIQUIDADO",
      message: "CEP validated. Payment confirmed.",
    });
  }

  return e.json(200, {
    ok: true,
    status: evaluation.newStatus,
    message: "CEP validation failed: " + evaluation.reason,
  });
});
