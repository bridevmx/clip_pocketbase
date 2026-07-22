/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// SPEI/CEP Plugin — Bootstrap hook.
// Runs once at PocketBase startup to verify collections exist.
// ─────────────────────────────────────────────────────────────────────────

onBootstrap((e) => {
  const requiredCollections = ["spei_settings", "spei_orders", "cep_verifications", "spei_banks"];
  const missing = [];

  for (const name of requiredCollections) {
    try {
      $app.findCollectionByNameOrId(name);
    } catch (_) {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    $app.logger().warn(
      "[SPEI] Missing collections — run migrations before using the SPEI plugin",
      "missing", missing.join(", ")
    );
  } else {
    $app.logger().info("[SPEI] Plugin loaded — all collections present");
  }

  e.next();
});
