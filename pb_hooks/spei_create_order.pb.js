/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// POST /api/spei/create-order — Create a SPEI payment order (SECURE & MULTI-TENANT)
//
// Resolves beneficiary account (spei_settings) and exact amount server-side
// based on reference_collection and reference_id using parameterized bind queries.
//
// Request body:
//   reference_collection  (required) — "customer_orders" or "dropper_orders"
//   reference_id          (required) — Record ID in that collection
//   spei_settings_id      (optional) — Explicit ID override if provided and valid
//
// Response (success):
//   { order_id, status, spei_settings: { clabe, bank_name, account_holder } }
// ─────────────────────────────────────────────────────────────────────────

routerAdd("POST", "/api/spei/create-order", (e) => {
  const info = e.requestInfo();
  const body = info.body || {};

  const referenceCollection = body["reference_collection"];
  const referenceId = body["reference_id"];
  const clientSpeiSettingsId = body["spei_settings_id"];

  const userId = info.auth ? info.auth.id : null;

  if (!referenceCollection || !referenceId) {
    throw new BadRequestError("reference_collection and reference_id are required");
  }

  let finalAmount = 0;
  let speiSettings = null;

  // ─── 1. SECURE SERVER-SIDE RESOLUTION ─────────────────────────────────────
  if (referenceCollection === "customer_orders") {
    let customerOrder;
    try {
      customerOrder = $app.findRecordById("customer_orders", referenceId);
    } catch (_) {
      throw new NotFoundError("customer_order not found");
    }

    finalAmount = customerOrder.get("total") || 0;
    const shopId = customerOrder.getString("shop");

    // Buscar cuenta de la tienda usando parámetros vinculados seguros
    try {
      speiSettings = $app.findFirstRecordByFilter(
        "spei_settings",
        "shop = {:shop} && is_active = true",
        { shop: shopId }
      );
    } catch (_) {}

    // Fallback: Si la tienda aún no tiene cuenta propia, buscar la cuenta activa provista o global
    if (!speiSettings && clientSpeiSettingsId) {
      try {
        const clientSettings = $app.findRecordById("spei_settings", clientSpeiSettingsId);
        if (clientSettings.getBool("is_active")) {
          speiSettings = clientSettings;
        }
      } catch (_) {}
    }

  } else if (referenceCollection === "dropper_orders") {
    let dropperOrder;
    try {
      dropperOrder = $app.findRecordById("dropper_orders", referenceId);
    } catch (_) {
      throw new NotFoundError("dropper_order not found");
    }

    finalAmount = dropperOrder.get("total") || 0;

    // Buscar cuenta del Supplier (user con rol admin) usando parámetros vinculados seguros
    try {
      speiSettings = $app.findFirstRecordByFilter(
        "spei_settings",
        "user.role = 'admin' && is_active = true"
      );
    } catch (_) {}

    if (!speiSettings && clientSpeiSettingsId) {
      try {
        const clientSettings = $app.findRecordById("spei_settings", clientSpeiSettingsId);
        if (clientSettings.getBool("is_active")) {
          speiSettings = clientSettings;
        }
      } catch (_) {}
    }
  } else {
    throw new BadRequestError("Invalid reference_collection");
  }

  // Fallback general: si no se encontró por relaciones explícitas, tomar primera activa
  if (!speiSettings) {
    try {
      speiSettings = $app.findFirstRecordByFilter("spei_settings", "is_active = true");
    } catch (_) {}
  }

  if (!speiSettings) {
    throw new BadRequestError("No active SPEI beneficiary account configured");
  }

  if (finalAmount <= 0 || finalAmount > 999999) {
    throw new BadRequestError("Invalid or zero order amount");
  }

  // ─── 2. CREACIÓN DE REGISTRO EN TRANSACCIÓN ───────────────────────────────
  let order;
  $app.runInTransaction((txApp) => {
    const ordersCollection = txApp.findCollectionByNameOrId("spei_orders");
    order = new Record(ordersCollection);
    if (userId) {
      order.set("user", userId);
    }
    order.set("reference_collection", referenceCollection);
    order.set("reference_id", referenceId);
    order.set("amount", finalAmount);
    order.set("currency", "MXN");
    order.set("status", "PENDING");
    order.set("spei_settings", speiSettings.id);
    order.set("cuenta_beneficiaria", speiSettings.getString("clabe"));
    txApp.save(order);
  });

  $app.logger().info(
    "[SPEI SECURE] Order created",
    "order_id", order.id,
    "amount", finalAmount,
    "clabe", speiSettings.getString("clabe")
  );

  return e.json(200, {
    order_id: order.id,
    status: "PENDING",
    spei_settings: {
      clabe: speiSettings.getString("clabe"),
      bank_name: speiSettings.getString("bank_name"),
      account_holder: speiSettings.getString("account_holder"),
    },
  });
});
