/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// POST /api/spei/report-payment — Report a SPEI payment and trigger CEP validation (SECURE).
// ─────────────────────────────────────────────────────────────────────────

routerAdd("POST", "/api/spei/report-payment", (e) => {
  const spei = require(`${__hooks}/spei_api_client.js`);
  const rl = require(`${__hooks}/rate_limiter.js`);
  const info = e.requestInfo();
  const body = info.body || {};

  var rawAddr = e.request.remoteAddr || "";
  var clientIp;
  if (rawAddr.startsWith("[")) {
    // IPv6: "[::1]:port" -> "::1"
    clientIp = rawAddr.replace(/^\[/, "").split("]:")[0] || "unknown";
  } else {
    // IPv4: "1.2.3.4:port" -> "1.2.3.4"
    clientIp = rawAddr.split(":")[0] || "unknown";
  }
  var rlResult = rl.checkLimit("spei_report:" + clientIp, 10, 60 * 1000); // 10 req/min per IP
  if (!rlResult.allowed) {
    $app.logger().warn("[SPEI] Rate limit exceeded", "ip", clientIp);
    throw new ApiError(429, "Too many requests. Please wait before reporting another payment.");
  }

  const orderId = body["order_id"];
  const criterio = body["criterio"];
  const emisor = body["emisor"];
  const montoDeclarado = body["monto_declarado"];
  const fechaPago = body["fecha_pago"];

  if (!orderId || !criterio || !emisor || !montoDeclarado) {
    throw new BadRequestError("order_id, criterio, emisor and monto_declarado are required");
  }

  // Validate fecha_pago if provided
  if (fechaPago) {
    var fechaTest = new Date(fechaPago);
    if (isNaN(fechaTest.getTime())) {
      throw new BadRequestError("Invalid fecha_pago: must be a valid date");
    }
    // No aceptar fechas en el futuro (más de 1 hora de margen)
    var oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    if (fechaTest > oneHourFromNow) {
      throw new BadRequestError("Invalid fecha_pago: cannot be a future date");
    }
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
  if (currentStatus !== "PENDING" && currentStatus !== "REPORTED") {
    throw new BadRequestError("Order status is " + currentStatus + ", cannot report payment.");
  }

  // ─── SECURITY CHECK 1: Order expiration (24h) ──────────────────────────
  var created = new Date(order.getString("created"));
  var now = new Date();
  var diffHours = (now - created) / (1000 * 60 * 60);
  if (diffHours > 24) {
    throw new BadRequestError("Order has expired (older than 24 hours)");
  }

  // ─── SECURITY CHECK 2: Validate declared amount ────────────────────────
  var orderAmount = order.getFloat("amount");
  var declared = parseFloat(montoDeclarado);
  if (isNaN(declared) || declared <= 0) {
    throw new BadRequestError("monto_declarado must be a positive number");
  }

  var amountDiff = Math.abs(orderAmount - declared);
  if (amountDiff > 0.01) {
    throw new BadRequestError(
      "Declared amount ($" + declared + ") does not match order amount ($" + orderAmount + ")"
    );
  }

  // Resolve receptor data from order
  var receptorData = spei.resolveReceptorFromOrder($app, order);

  // Strict whitelist validation — prevents HTTP Parameter Pollution and injection
  try {
    spei.validateSpeiInputs(criterio, emisor, receptorData.cuenta, declared);
  } catch (validationErr) {
    throw validationErr; // Re-throw BadRequestError from validator
  }

  // ─── STEP 1 & 2: TRANSACTION 1 — Anti-Fraud Check & Reserve CEP Record ───
  var cepRecId = "";
  $app.runInTransaction((txApp) => {
    // SECURITY CHECK 3: Anti-Fraud Double-Spend Protection inside transaction
    var existingCep = txApp.findFirstRecordByFilter(
      "cep_verifications",
      "(criterio = {:crit} || tracking_code = {:crit}) && order != {:orderId} && status_name = 'LIQUIDADO'",
      { crit: criterio, orderId: orderId }
    );
    if (existingCep) {
      throw new BadRequestError("Anti-fraud: This payment reference has already been used");
    }

    var cepCollection = txApp.findCollectionByNameOrId("cep_verifications");
    var cepRec;
    try {
      cepRec = txApp.findFirstRecordByFilter("cep_verifications", "order = {:orderId}", { orderId: orderId });
    } catch (_) {
      cepRec = new Record(cepCollection);
      cepRec.set("order", orderId);
    }

    if (cepRec.getString("status_name") === "LIQUIDADO") {
      throw new BadRequestError("Anti-fraud: This payment reference has already been used");
    }

    cepRec.set("criterio", criterio);
    cepRec.set("emisor", emisor);
    cepRec.set("monto_declarado", String(declared));
    cepRec.set("status_name", "VALIDATING");
    cepRec.set("validated_match", false);
    cepRec.set("mismatch_reason", "Validating with Banxico CEP");
    txApp.save(cepRec);

    cepRecId = cepRec.id;

    // Reload order inside transaction to update
    var txOrder = txApp.findRecordById("spei_orders", orderId);
    txOrder.set("criterio", criterio);
    txOrder.set("emisor", emisor);
    txOrder.set("monto_declarado", String(declared));
    txOrder.set("submitted_at", new Date().toISOString());
    txOrder.set("status", "REPORTED");
    txApp.save(txOrder);
  });

  // ─── STEP 3: OUTSIDE TRANSACTION — Banxico CEP Validation (HTTP Request) ───
  var targetDate = fechaPago ? fechaPago : created;
  var fechaFormat = spei.formatCepDate(targetDate);

  var cepResult = { data: {} };
  try {
    cepResult = spei.validate(
      fechaFormat,
      criterio,
      emisor,
      receptorData.receptor,
      receptorData.cuenta,
      declared
    );
  } catch (errScrape) {
    $app.logger().warn("[SPEI] Scraping CEP warning", "err", errScrape.message);
    cepResult = { data: { status: "en proceso" } };
  }

  var evaluation = spei.evaluateCepResult(
    cepResult.data || {},
    declared,
    receptorData.cuenta
  );

  // ─── STEP 4 & 5: TRANSACTION 2 — Update CEP & Handle Unique Constraint ───
  var isLiquidado = false;
  try {
    $app.runInTransaction((txApp2) => {
      var cepRecFinal = txApp2.findRecordById("cep_verifications", cepRecId);
      var orderFinal = txApp2.findRecordById("spei_orders", orderId);

      cepRecFinal.set("reference", cepResult.data.reference || (criterioType === "R" ? criterio : ""));
      cepRecFinal.set("tracking_code", cepResult.data.trackingCode || (criterioType === "T" ? criterio : ""));
      cepRecFinal.set("issuing_bank", cepResult.data.issuingBank || emisor);
      cepRecFinal.set("receiving_bank", cepResult.data.receivingBank || receptorData.receptor);
      cepRecFinal.set("beneficiary_account", cepResult.data.beneficiaryAccount || receptorData.cuenta);
      cepRecFinal.set("amount", cepResult.data.amount ? parseFloat(cepResult.data.amount) : declared);
      cepRecFinal.set("raw_response", JSON.stringify(cepResult.data || {}));

      if (!evaluation.isMatch) {
        var nextRetry = new Date(Date.now() + 5 * 60 * 1000);
        orderFinal.set("next_retry_at", nextRetry.toISOString());
        orderFinal.set("status", "REPORTED");
        orderFinal.set("retry_count", (orderFinal.getInt("retry_count") || 0) + 1);
        txApp2.save(orderFinal);

        cepRecFinal.set("status_name", "REPORTED");
        cepRecFinal.set("validated_match", false);
        cepRecFinal.set("mismatch_reason", evaluation.reason || "CEP no disponible aún en Banxico. Reintento automático programado.");
        txApp2.save(cepRecFinal);
        isLiquidado = false;
      } else {
        // Double-check duplicate settled criterio before marking as LIQUIDADO
        var duplicateCheck = txApp2.findFirstRecordByFilter(
          "cep_verifications",
          "criterio = {:crit} && status_name = 'LIQUIDADO' && id != {:cepId}",
          { crit: criterio, cepId: cepRecId }
        );
        if (duplicateCheck) {
          throw new BadRequestError("Anti-fraud: This payment reference has already been used");
        }

        orderFinal.set("validated_at", new Date().toISOString());
        orderFinal.set("status", "LIQUIDADO");
        orderFinal.set("next_retry_at", null);
        txApp2.save(orderFinal);

        cepRecFinal.set("status_name", "LIQUIDADO");
        cepRecFinal.set("validated_match", true);
        cepRecFinal.set("mismatch_reason", null);
        txApp2.save(cepRecFinal); // Unique constraint idx_cep_unique_settled_criterio will be enforced here
        isLiquidado = true;
      }
    });
  } catch (errSave) {
    var errStr = String(errSave.message || errSave);
    if (errSave.status === 400 || errStr.indexOf("Anti-fraud") !== -1) {
      throw new BadRequestError("Anti-fraud: This payment reference has already been used");
    }
    if (
      errStr.indexOf("UNIQUE constraint failed") !== -1 ||
      errStr.indexOf("idx_cep_unique_settled_criterio") !== -1
    ) {
      throw new BadRequestError("Anti-fraud: This payment reference has already been used");
    }
    throw errSave;
  }

  if (!isLiquidado) {
    $app.logger().info("[SPEI] Payment reported as pending match", "order_id", orderId);

    return e.json(200, {
      ok: true,
      status: "REPORTED",
      is_liquidado: false,
      message: "Pago reportado correctamente. La transferencia se encuentra en proceso de validación con Banxico CEP.",
    });
  }

  $app.logger().info("[SPEI] Order LIQUIDADO por Banxico CEP", "order_id", orderId);

  return e.json(200, {
    ok: true,
    status: "LIQUIDADO",
    is_liquidado: true,
    message: "¡Pago verificado y LIQUIDADO exitosamente por Banxico!",
  });
});
