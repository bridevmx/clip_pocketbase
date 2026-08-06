/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// INTEGRACIÓN DEL PLUGIN SPEI/CEP CON EL SISTEMA DROPPER
//
// Este handler reacciona automáticamente a los cambios de estado en `spei_orders`:
// 1. Cuando la transferencia es validada exitosamente por Banxico (LIQUIDADO):
//    - Marca la orden B2C (`customer_orders`) como "paid" (disparando auto_b2b_order).
//    - Activa la membresía (`customer_memberships`) con regla de acumulación de días (rollover).
// 2. Si la validación falla o excede los 12 reintentos (MANUAL_REVIEW):
//    - Notifica al log y marca la orden para revisión manual por el Admin.
// ─────────────────────────────────────────────────────────────────────────

onRecordAfterUpdateSuccess((e) => {
    const status = e.record.getString("status");
    const speiOrderId = e.record.id;
    const refCollection = e.record.getString("reference_collection");
    const refId = e.record.getString("reference_id");

    console.log(`[SPEI INTEGRATOR] Orden SPEI ${speiOrderId} cambió a estado: ${status} | Referencia: ${refCollection}:${refId}`);

    if (status === "LIQUIDADO") {
        if (refCollection === "customer_orders" && refId) {
            try {
                const customerOrder = $app.findRecordById("customer_orders", refId);
                if (customerOrder.getString("status") !== "paid") {
                    console.log(`[SPEI INTEGRATOR] ✅ Transferencia validada por Banxico para orden B2C ${refId}. Marcando como PAGADA...`);
                    customerOrder.set("status", "paid");
                    $app.save(customerOrder);
                    console.log(`[SPEI INTEGRATOR] ✅ Orden ${refId} marcada como 'paid'. El hook Auto-B2B generará la orden B2B correspondientemente.`);
                }
            } catch (err) {
                console.error(`[SPEI INTEGRATOR ERROR] Error al actualizar la orden B2C ${refId}: ${err.message}`);
            }
        }

        if (refCollection === "customer_memberships" && refId) {
            try {
                const cmRec = $app.findRecordById("customer_memberships", refId);
                if (cmRec.getString("status") !== "active") {
                    console.log(`[SPEI INTEGRATOR] ✅ Transferencia validada para membresía ${refId}. Activando con regla de rollover...`);
                    const userId = cmRec.getString("customer");
                    const membId = cmRec.getString("membership");
                    const membRec = $app.findRecordById("memberships", membId);
                    const durationDays = membRec.getInt("duration_days") || 30;

                    const nowTime = new Date();
                    const nowMex = new Date(nowTime.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
                    let baseDate = nowMex;

                    // Acumulación: buscar si el usuario tiene fecha de vencimiento activa en el futuro
                    try {
                        const activeRecords = $app.findRecordsByFilter(
                            "customer_memberships",
                            "customer = {:userId} && status = 'active' && id != {:newId}",
                            "-end_date",
                            1,
                            0,
                            { userId: userId, newId: cmRec.id }
                        );
                        if (activeRecords.length > 0) {
                            const currEndDateStr = activeRecords[0].getString("end_date");
                            if (currEndDateStr) {
                                const currEndDate = new Date(currEndDateStr);
                                if (currEndDate > nowMex) {
                                    baseDate = currEndDate;
                                }
                            }
                        }
                    } catch (_) {}

                    const startDate = new Date(Date.UTC(nowMex.getFullYear(), nowMex.getMonth(), nowMex.getDate(), 0, 0, 0));
                    const endDate = new Date(Date.UTC(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + durationDays, 23, 59, 59, 999));

                    // Desactivar membresías previas del usuario
                    try {
                        const oldRecords = $app.findRecordsByFilter(
                            "customer_memberships",
                            "customer = {:userId} && status = 'active' && id != {:newId}",
                            "-created",
                            100,
                            0,
                            { userId: userId, newId: cmRec.id }
                        );
                        for (let k = 0; k < oldRecords.length; k++) {
                            oldRecords[k].set("status", "cancelled");
                            $app.save(oldRecords[k]);
                        }
                    } catch (_) {}

                    cmRec.set("status", "active");
                    cmRec.set("start_date", startDate.toISOString());
                    cmRec.set("end_date", endDate.toISOString());
                    $app.save(cmRec);
                    console.log(`[SPEI INTEGRATOR] ✅ Membresía ${refId} activada exitosamente hasta ${endDate.toISOString()}`);
                }
            } catch (errCm) {
                console.error(`[SPEI INTEGRATOR ERROR] Error activando customer_memberships ${refId}: ${errCm.message}`);
            }
        }
    }

    if (status === "MANUAL_REVIEW") {
        console.log(`[SPEI INTEGRATOR] ⚠️ Transferencia requiere REVISIÓN MANUAL para ${refCollection}:${refId}. Notificando al panel admin...`);
        $app.logger().warn("[SPEI INTEGRATOR] Pago transferido requiere revisión manual", "ref_collection", refCollection, "ref_id", refId, "spei_order_id", speiOrderId);
    }

    if (status === "REJECTED" || status === "EXPIRED") {
        console.log(`[SPEI INTEGRATOR] ❌ Transferencia ${status} para ${refCollection}:${refId}.`);
        $app.logger().warn(`[SPEI INTEGRATOR] Pago transferido ${status}`, "ref_collection", refCollection, "ref_id", refId, "spei_order_id", speiOrderId);
    }

    if (typeof e.next === 'function') e.next();
}, "spei_orders");
