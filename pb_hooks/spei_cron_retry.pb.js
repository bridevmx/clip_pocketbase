/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// SPEI/CEP Plugin — Cron Job para Reintento Automático de Validación CEP
//
// Se ejecuta periódicamente en segundo plano (cada 2 minutos) para consultar
// a Banxico CEP aquellas órdenes con estado "REPORTED" cuyo tiempo de reintento
// haya llegado (next_retry_at <= NOW).
//
// Al ser validada exitosamente como "LIQUIDADO", al llamar $app.save(order),
// PocketBase dispara el handler `my_app_spei_handler.pb.js` que activa
// automáticamente las membresías o genera las órdenes B2B.
// ─────────────────────────────────────────────────────────────────────────

cronAdd("spei_auto_retry_cep", "*/2 * * * *", () => {
    const spei = require(`${__hooks}/spei_api_client.js`);
    const nowIso = new Date().toISOString();

    $app.logger().info("[SPEI CRON] Iniciando ciclo de reintento automático CEP...");

    // Buscar hasta 20 órdenes en estado REPORTED listas para reintento
    let pendingOrders = [];
    try {
        pendingOrders = $app.findRecordsByFilter(
            "spei_orders",
            "status = 'REPORTED' && (next_retry_at = '' || next_retry_at <= {:now})",
            "-created",
            20,
            0,
            { now: nowIso }
        );
    } catch (errSearch) {
        $app.logger().error("[SPEI CRON] Error al buscar órdenes pendientes para CEP", "error", errSearch.message);
        return;
    }

    if (pendingOrders.length === 0) {
        return;
    }

    $app.logger().info(`[SPEI CRON] Procesando ${pendingOrders.length} orden(es) SPEI pendientes de validación CEP.`);

    for (let i = 0; i < pendingOrders.length; i++) {
        const order = pendingOrders[i];
        const orderId = order.id;
        const criterio = order.getString("criterio");
        const emisor = order.getString("emisor");
        const montoDeclaradoStr = order.getString("monto_declarado");
        const amountNum = order.getFloat("amount");
        const declared = parseFloat(montoDeclaradoStr) || amountNum;
        const retryCount = (order.getInt("retry_count") || 0) + 1;

        if (!criterio || !emisor || !declared) {
            $app.logger().warn("[SPEI CRON] Orden incompleta omitida", "order_id", orderId);
            continue;
        }

        // Límite de seguridad: máximo 12 reintentos (aprox 1 hora)
        if (retryCount > 12) {
            $app.logger().warn("[SPEI CRON] Máximo de reintentos alcanzado. Moviendo a MANUAL_REVIEW", "order_id", orderId);
            order.set("status", "MANUAL_REVIEW");
            order.set("next_retry_at", null);
            order.set("validated_at", new Date().toISOString());
            $app.save(order);
            continue;
        }

        // Resolver banco y cuenta receptora desde spei_settings
        const receptorData = spei.resolveReceptorFromOrder($app, order);

        // Usar fecha de reporte o creación en formato DD-MM-YYYY
        const targetDate = order.getString("submitted_at") || order.getString("created");
        const fechaFormat = spei.formatCepDate(targetDate);

        let cepResult = { data: {} };
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
            $app.logger().warn("[SPEI CRON] Advertencia consultando Banxico CEP", "order_id", orderId, "err", errScrape.message);
            cepResult = { data: { status: "en proceso" } };
        }

        const evaluation = spei.evaluateCepResult(
            cepResult.data || {},
            declared,
            receptorData.cuenta
        );

        // Actualizar o crear registro en cep_verifications
        let cepCol = $app.findCollectionByNameOrId("cep_verifications");
        let cepRec;
        try {
            cepRec = $app.findFirstRecordByFilter("cep_verifications", "order = {:orderId}", { orderId: orderId });
        } catch (_) {
            cepRec = new Record(cepCol);
            cepRec.set("order", orderId);
        }

        cepRec.set("criterio", criterio);
        cepRec.set("emisor", emisor);
        cepRec.set("monto_declarado", String(declared));
        cepRec.set("reference", cepResult.data.reference || "");
        cepRec.set("tracking_code", cepResult.data.trackingCode || "");
        cepRec.set("issuing_bank", cepResult.data.issuingBank || emisor);
        cepRec.set("receiving_bank", cepResult.data.receivingBank || receptorData.receptor);
        cepRec.set("beneficiary_account", cepResult.data.beneficiaryAccount || receptorData.cuenta);
        cepRec.set("amount", cepResult.data.amount ? parseFloat(cepResult.data.amount) : declared);
        cepRec.set("raw_response", JSON.stringify(cepResult.data || {}));

        order.set("retry_count", retryCount);

        // ─── CASO 1: BANXICO CONFIRMA LA TRANSFERENCIA (LIQUIDADO) ──────────────
        if (evaluation.isMatch) {
            $app.logger().info("[SPEI CRON] 🎉 ¡Orden LIQUIDADA exitosamente por Banxico CEP!", "order_id", orderId);

            order.set("validated_at", new Date().toISOString());
            order.set("status", "LIQUIDADO");
            order.set("next_retry_at", null);
            $app.save(order); // Dispara my_app_spei_handler.pb.js

            cepRec.set("status", "LIQUIDADO");
            cepRec.set("validated_match", true);
            cepRec.set("mismatch_reason", null);
            $app.save(cepRec);

            continue;
        }

        // ─── CASO 2: TRANSFERENCIA EN PROCESO (REPROGRAMAR REINTENTO) ───────────
        if (evaluation.shouldRetry) {
            const nextRetry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutos más tarde
            order.set("next_retry_at", nextRetry.toISOString());
            $app.save(order);

            cepRec.set("status", "REPORTED");
            cepRec.set("validated_match", false);
            cepRec.set("mismatch_reason", evaluation.reason || "En proceso de indexación en Banxico.");
            $app.save(cepRec);

            $app.logger().info(`[SPEI CRON] Reintento ${retryCount}/12 programado a las ${nextRetry.toISOString()}`, "order_id", orderId);
            continue;
        }

        // ─── CASO 3: DIVERGENCIA NO SUBSANABLE O RECHAZO ──────────────────────
        order.set("status", "REJECTED");
        order.set("next_retry_at", null);
        $app.save(order);

        cepRec.set("status", "REJECTED");
        cepRec.set("validated_match", false);
        cepRec.set("mismatch_reason", evaluation.reason || "Rechazado por inconsistencia en Banxico CEP");
        $app.save(cepRec);

        $app.logger().warn("[SPEI CRON] Orden rechazada por inconsistencia en CEP", "order_id", orderId, "reason", evaluation.reason);
    }
});
