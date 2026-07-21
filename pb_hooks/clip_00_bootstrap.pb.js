/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
//  CLIP PAYMENT PLUGIN — Reference file (DO NOT EDIT)
// ─────────────────────────────────────────────────────────────────────────
// This plugin does NOT know your business logic. It only manages:
//   - Collection: clip_orders   (generic payment order)
//   - Collection: clip_payments (raw event audit log)
//   - Route:      POST /api/clip/create-link
//   - Route:      POST /api/clip/webhook
//
// To connect your business logic (activate product, send email,
// unlock access, etc.), do NOT edit the clip_*.pb.js files.
// Instead, create or edit:
//
//     pb_hooks/my_app_clip_handler.pb.js
//
// ─────────────────────────────────────────────────────────────────────────

onBootstrap((e) => {
    e.next();
    console.log("");
    console.log("[CLIP PLUGIN] Loaded successfully.");
    console.log("[CLIP PLUGIN] Expected collections: clip_orders, clip_payments");
    console.log("[CLIP PLUGIN] Active routes: POST /api/clip/create-link, POST /api/clip/webhook");
    console.log("[CLIP PLUGIN] To add your business logic after payment, create/edit:");
    console.log("[CLIP PLUGIN]   -> pb_hooks/my_app_clip_handler.pb.js");
    console.log("[CLIP PLUGIN]   -> Listen: onRecordAfterUpdateSuccess((e) => {...}, \"clip_orders\")");
    console.log("");
});
