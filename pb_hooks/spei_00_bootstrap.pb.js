/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// SPEI/CEP Plugin — Bootstrap hook.
// Runs once at PocketBase startup to print status messages.
// Collections are created by migrations, not verified here.
// ─────────────────────────────────────────────────────────────────────────

onBootstrap((e) => {
  e.next();
  console.log("");
  console.log("[SPEI PLUGIN] Loaded successfully.");
  console.log("[SPEI PLUGIN] Expected collections: spei_settings, spei_orders, cep_verifications, spei_banks");
  console.log("[SPEI PLUGIN] Active routes: POST /api/spei/create-order, POST /api/spei/report-payment");
  console.log("[SPEI PLUGIN]                 POST /api/spei/validate-cep, GET /api/spei/order/{id}/status");
  console.log("[SPEI PLUGIN] Business logic: -> pb_hooks/my_app_spei_handler.pb.js");
  console.log("");
});
