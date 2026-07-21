/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
//  CLIP PAYMENT PLUGIN — Archivo de referencia (NO EDITAR)
// ─────────────────────────────────────────────────────────────────────────
// Este plugin NO conoce tu modelo de negocio. Solo gestiona:
//   - Colección: clip_orders   (orden de cobro genérica)
//   - Colección: clip_payments (bitácora de eventos)
//   - Ruta:      POST /api/clip/create-link
//   - Ruta:      POST /api/clip/webhook
//
// Para conectar tu lógica de negocio (activar producto, mandar email,
// desbloquear acceso, etc.), NO edites los archivos clip_*.pb.js.
// Crea/edita en su lugar:
//
//     pb_hooks/my_app_clip_handler.pb.js
//
// ─────────────────────────────────────────────────────────────────────────

onBootstrap((e) => {
    e.next();
    console.log("");
    console.log("🔌 [CLIP PLUGIN] Cargado correctamente.");
    console.log("🔌 [CLIP PLUGIN] Colecciones esperadas: clip_orders, clip_payments");
    console.log("🔌 [CLIP PLUGIN] Rutas activas: POST /api/clip/create-link, POST /api/clip/webhook");
    console.log("🔌 [CLIP PLUGIN] Ruta exacta para tu lógica de negocio ->");
    console.log("🔌 [CLIP PLUGIN]   pb_hooks/my_app_clip_handler.pb.js");
    console.log("🔌 [CLIP PLUGIN] Escucha: onRecordAfterUpdateSuccess((e) => {...}, \"clip_orders\")");
    console.log("");
});
