/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// TU LÓGICA DE NEGOCIO — este archivo NO es parte del plugin de Clip.
// Edítalo libremente. Se ejecuta cuando una clip_order cambia de estado.
// ─────────────────────────────────────────────────────────────────────────

onRecordAfterUpdateSuccess((e) => {
    const status = e.record.getString("status");

    if (status === "COMPLETED") {
        const refCollection = e.record.getString("reference_collection");
        const refId = e.record.getString("reference_id");
        const userId = e.record.getString("user");

        $app.logger().info(
            "✅ Pago completado, activar lógica de negocio",
            "reference_collection", refCollection,
            "reference_id", refId,
            "user", userId
        );

        // TODO: aquí tu lógica -> activar producto, mandar email,
        // desbloquear un viaje, marcar un pedido de repostería como pagado, etc.
    }

    e.next();
}, "clip_orders");
