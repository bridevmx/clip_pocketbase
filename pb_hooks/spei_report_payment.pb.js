/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// POST /api/spei/report-payment — Report a SPEI payment and trigger CEP validation.
//
// The user calls this endpoint after making a SPEI transfer.
// It updates the order status to REPORTED and triggers automatic CEP validation.
//
// Request body:
//   order_id       (required) — The spei_orders record ID
//   criterio       (required) — Reference (7 chars) or tracking code (8-30 chars)
//   emisor         (required) — Issuing bank code (e.g. "40012")
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
  // Get spei_settings for receptor bank and CLABE
  var speiSettingsId = order.getString("spei_settings");
  var receptor = "";
  var cuenta = order.getString("cuenta_beneficiaria");

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
    cepResult = spei.validar(fecha, criterio, emisor, receptor, cuenta, String(montoDeclarado));
  } catch (err) {
    $app.logger().error("[SPEI] CEP validation error", "error", err.message);
    // Don't fail the report — mark as REPORTED and let retry handle it
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

  // ─── Evaluate CEP result ───────────────────────────────────────────────
  if (!cepResult.data.found) {
    // CEP not found — schedule retry
    order.set("retry_count", (order.getInt("retry_count") || 0) + 1);
    order.set("next_retry_at", new Date(now.getTime() + 5 * 60 * 1000).toISOString());
    cepRec.set("validated_match", false);
    cepRec.set("mismatch_reason", "CEP not found: " + (cepResult.data.message || "unknown"));
    $app.save(cepRec);
    $app.save(order);

    return e.json(200, {
      ok: true,
      status: "REPORTED",
      message: "Payment reported. CEP not found yet — will retry in 5 minutes.",
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

  // Update order based on result
  order.set("validated_at", new Date().toISOString());

  if (isExactMatch) {
    order.set("status", "LIQUIDADO");
    $app.save(order);

    $app.logger().info("[SPEI] Order LIQUIDADO", "order_id", orderId);

    return e.json(200, {
      ok: true,
      status: "LIQUIDADO",
      message: "CEP validated successfully. Payment confirmed.",
    });
  } else {
    // Mismatch — check if status is "en proceso" for retry
    if (cepStatus.indexOf("en proceso") !== -1) {
      // Schedule retry
      var retryCount = (order.getInt("retry_count") || 0) + 1;
      order.set("retry_count", retryCount);

      if (retryCount >= 12) {
        // Too many retries — escalate to manual review
        order.set("status", "MANUAL_REVIEW");
        $app.save(order);

        return e.json(200, {
          ok: true,
          status: "MANUAL_REVIEW",
          message: "Transfer is still in process after multiple retries. Escalated to manual review.",
        });
      }

      // Schedule next retry (5 minutes)
      order.set("next_retry_at", new Date(now.getTime() + 5 * 60 * 1000).toISOString());
      $app.save(order);

      return e.json(200, {
        ok: true,
        status: "REPORTED",
        message: "Transfer in process. Will retry in 5 minutes (attempt " + retryCount + "/12).",
      });
    }

    // Other mismatch — reject
    order.set("status", "REJECTED");
    $app.save(order);

    return e.json(200, {
      ok: true,
      status: "REJECTED",
      message: "CEP validation failed: " + (cepRec.getString("mismatch_reason") || "values do not match"),
    });
  }
});
