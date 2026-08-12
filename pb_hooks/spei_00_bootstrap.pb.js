/// <reference path="../pb_data/types.d.ts" />
// SPEI plugin routes and hooks are loaded automatically by PocketBase.
// Configuration validation runs in clip_00_bootstrap.pb.js at startup.
// To customize SPEI business logic, edit: pb_hooks/my_app_spei_handler.pb.js

onBootstrap((e) => {
  if (typeof e.next === "function") e.next();
  // SPEI plugin loaded — validation handled by clip_00_bootstrap.pb.js
});
