/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// POST /api/spei/report-payment — Report a SPEI payment and trigger CEP validation (SECURE).
// ─────────────────────────────────────────────────────────────────────────

routerAdd("POST", "/api/spei/report-payment", (e) => {
  const spei = require(`${__hooks}/spei_api_client.js`);
  const info = e.requestInfo();
  const body = info.body || {};

  const orderId = body["order_id"];
  const criterio = body["criterio"];
  const emisor = body["emisor"];
  const montoDeclarado = body["monto_declarado"];
  const fechaPago = body["fecha_pago"];

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

  // ─── SECURITY CHECK 3: Anti-Fraud Double-Spend Protection ─────────────
  // Validar que la misma clave de rastreo/folio no haya sido utilizada ya en otra orden o membresía
  try {
    var existingCep = $app.findFirstRecordByFilter(
      "cep_verifications",
      "(criterio = {:crit} || tracking_code = {:crit}) && order != {:orderId} && (status = 'LIQUIDADO' || status = 'REPORTED')",
      { crit: criterio, orderId: orderId }
    );
    if (existingCep) {
      throw new BadRequestError("Seguridad Anti-Fraude: Esta clave de rastreo/folio ya fue utilizada en otro pago de membresía.");
    }
  } catch (errCheck) {
    if (errCheck.status === 400) throw errCheck;
  }

  // Resolve receptor account and bank from spei_settings
  var receptorData = spei.resolveReceptorFromOrder($app, order);
  
  // Utilizar la fecha indicada por el usuario o fallback a la fecha de creación en zona horaria America/Mexico_City
  var targetDate = fechaPago ? fechaPago : created;
  var fechaFormat = spei.formatCepDate(targetDate);

  // ─── CEP VALIDATION VIA BANXICO NATIVO ─────────────────────────────────
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

  // Update or create cep_verifications record
  var cepCollection = $app.findCollectionByNameOrId("cep_verifications");
  var cepRec;
  try {
    cepRec = $app.findFirstRecordByFilter("cep_verifications", "order = {:orderId}", { orderId: orderId });
  } catch (_) {
    cepRec = new Record(cepCollection);
    cepRec.set("order", orderId);
  }

  cepRec.set("criterio", criterio);
  cepRec.set("emisor", emisor);
  cepRec.set("monto_declarado", String(declared));
  cepRec.set("reference", cepResult.data.reference || (criterioType === "R" ? criterio : ""));
  cepRec.set("tracking_code", cepResult.data.trackingCode || (criterioType === "T" ? criterio : ""));
  cepRec.set("issuing_bank", cepResult.data.issuingBank || emisor);
  cepRec.set("receiving_bank", cepResult.data.receivingBank || receptorData.receptor);
  cepRec.set("beneficiary_account", cepResult.data.beneficiaryAccount || receptorData.cuenta);
  cepRec.set("amount", cepResult.data.amount ? parseFloat(cepResult.data.amount) : declared);
  cepRec.set("raw_response", JSON.stringify(cepResult.data || {}));

  // Save order updates
  order.set("criterio", criterio);
  order.set("emisor", emisor);
  order.set("monto_declarado", String(declared));
  order.set("submitted_at", new Date().toISOString());

  // SI NO HAY COINCIDENCIA EXACTA O LA TRANSFERENCIA AÚN NO ESTÁ DISPONIBLE EN BANXICO:
  if (!evaluation.isMatch) {
    var nextRetry = new Date(Date.now() + 5 * 60 * 1000);
    order.set("next_retry_at", nextRetry.toISOString());
    order.set("status", "REPORTED");
    order.set("retry_count", (order.getInt("retry_count") || 0) + 1);

    $app.save(order);

    cepRec.set("status", "REPORTED");
    cepRec.set("validated_match", false);
    cepRec.set("mismatch_reason", evaluation.reason || "CEP no disponible aún en Banxico. Reintento automático programado.");
    $app.save(cepRec);

    $app.logger().info("[SPEI] Payment reported as pending match", "order_id", orderId);

    return e.json(200, {
      ok: true,
      status: "REPORTED",
      is_liquidado: false,
      message: "Pago reportado correctamente. La transferencia se encuentra en proceso de validación con Banxico CEP.",
    });
  }

  // SI HAY COINCIDENCIA CONFIRMADA POR BANXICO (LIQUIDADO):
  order.set("validated_at", new Date().toISOString());
  order.set("status", "LIQUIDADO");
  order.set("next_retry_at", null);
  $app.save(order);

  cepRec.set("status", "LIQUIDADO");
  cepRec.set("validated_match", true);
  cepRec.set("mismatch_reason", null);
  $app.save(cepRec);

  $app.logger().info("[SPEI] Order LIQUIDADO por Banxico CEP", "order_id", orderId);

  return e.json(200, {
    ok: true,
    status: "LIQUIDADO",
    is_liquidado: true,
    message: "¡Pago verificado y LIQUIDADO exitosamente por Banxico!",
  });
});
