/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// POST /api/spei/validate-cep — Validate a SPEI order against Banxico CEP.
//
// This endpoint is called automatically by the retry mechanism.
// It can also be called manually by staff to force re-validation.
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
  var cuenta = order.getString("cuenta_beneficiaria");

  if (!criterio || !emisor || !montoDeclarado) {
    throw new BadRequestError("Order missing required fields for validation (criterio, emisor, monto_declarado)");
  }

  // Get receptor from spei_settings
  var receptor = "";
  var speiSettingsId = order.getString("spei_settings");
  if (speiSettingsId) {
    try {
      var speiSettings = $app.findRecordById("spei_settings", speiSettingsId);
      receptor = speiSettings.getString("bank_code");
      if (!cuenta) {
        cuenta = speiSettings.getString("clabe");
      }
    } catch (_) {}
  }

  // Format date for CEP (DD-MM-YYYY)
  var now = new Date();
  var day = String(now.getDate()).padStart(2, "0");
  var month = String(now.getMonth() + 1).padStart(2, "0");
  var year = now.getFullYear();
  var fecha = day + "-" + month + "-" + year;

  // Call CEP validation
  var cepResult;
  try {
    cepResult = spei.validar(fecha, criterio, emisor, receptor, cuenta, montoDeclarado);
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

  // If called by staff, set validated_by
  if (info.auth && info.auth.id) {
    cepRec.set("validated_by", info.auth.id);
  }

  $app.save(cepRec);

  // ─── Evaluate CEP result ───────────────────────────────────────────────
  if (!cepResult.data.found) {
    var retryCount = (order.getInt("retry_count") || 0) + 1;
    order.set("retry_count", retryCount);

    if (retryCount >= 12) {
      order.set("status", "MANUAL_REVIEW");
      order.set("validated_at", new Date().toISOString());
      $app.save(order);

      return e.json(200, {
        ok: true,
        status: "MANUAL_REVIEW",
        message: "CEP not found after maximum retries. Escalated to manual review.",
      });
    }

    // Schedule next retry (5 minutes)
    order.set("next_retry_at", new Date(now.getTime() + 5 * 60 * 1000).toISOString());
    $app.save(order);

    cepRec.set("validated_match", false);
    cepRec.set("mismatch_reason", "CEP not found");
    $app.save(cepRec);

    return e.json(200, {
      ok: true,
      status: "PENDING",
      message: "CEP not found. Retry " + retryCount + "/12 scheduled.",
    });
  }

  // CEP found — validate match
  var cepAmount = parseFloat(cepResult.data.amount) || 0;
  var declaredAmount = parseFloat(montoDeclarado) || 0;
  var cepAccount = cepResult.data.beneficiaryAccount || "";
  var expectedAccount = cuenta;
  var cepStatus = (cepResult.data.status || "").toLowerCase();

  var amountMatch = Math.abs(cepAmount - declaredAmount) < 0.01;
  var accountMatch = cepAccount === expectedAccount;
  var statusMatch = cepStatus === "liquidado";

  var isExactMatch = amountMatch && accountMatch && statusMatch;
  cepRec.set("validated_match", isExactMatch);

  if (!isExactMatch) {
    var reasons = [];
    if (!amountMatch) reasons.push("amount mismatch");
    if (!accountMatch) reasons.push("account mismatch");
    if (!statusMatch) reasons.push("status not liquidado");
    cepRec.set("mismatch_reason", reasons.join(", "));
  }

  $app.save(cepRec);

  // Update order
  order.set("validated_at", new Date().toISOString());

  if (isExactMatch) {
    order.set("status", "LIQUIDADO");
    order.set("next_retry_at", null);
    $app.save(order);

    return e.json(200, {
      ok: true,
      status: "LIQUIDADO",
      message: "CEP validated. Payment confirmed.",
    });
  }

  // Not liquidado — check for retry
  if (cepStatus.indexOf("en proceso") !== -1) {
    var retryCount2 = (order.getInt("retry_count") || 0) + 1;
    order.set("retry_count", retryCount2);

    if (retryCount2 >= 12) {
      order.set("status", "MANUAL_REVIEW");
      $app.save(order);

      return e.json(200, {
        ok: true,
        status: "MANUAL_REVIEW",
        message: "Transfer still in process after maximum retries.",
      });
    }

    order.set("next_retry_at", new Date(now.getTime() + 5 * 60 * 1000).toISOString());
    $app.save(order);

    return e.json(200, {
      ok: true,
      status: currentStatus,
      message: "Transfer in process. Retry " + retryCount2 + "/12 scheduled.",
    });
  }

  // Other status — reject
  order.set("status", "REJECTED");
  order.set("next_retry_at", null);
  $app.save(order);

  return e.json(200, {
    ok: true,
    status: "REJECTED",
    message: "CEP validation failed: " + (cepRec.getString("mismatch_reason") || "status not liquidado"),
  });
});
