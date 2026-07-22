/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// POST /api/spei/create-order — Create a SPEI payment order.
//
// Returns beneficiary account details so the user can make a SPEI transfer.
//
// Request body:
//   amount                (required) — Amount in MXN
//   reference_collection  (required) — Your collection name
//   reference_id          (required) — Record ID in that collection
//   spei_settings_id      (required) — ID of the beneficiary account
//
// Response (success):
//   { order_id, status, spei_settings: { clabe, bank_name, account_holder } }
// ─────────────────────────────────────────────────────────────────────────

routerAdd("POST", "/api/spei/create-order", (e) => {
  const info = e.requestInfo();
  const body = info.body;

  const amount = body["amount"];
  const referenceCollection = body["reference_collection"];
  const referenceId = body["reference_id"];
  const speiSettingsId = body["spei_settings_id"];

  // Authentication is optional — guest checkouts are allowed.
  const userId = info.auth ? info.auth.id : null;

  if (!amount || !referenceCollection || !referenceId || !speiSettingsId) {
    throw new BadRequestError("amount, reference_collection, reference_id and spei_settings_id are required");
  }
  if (amount <= 0 || amount > 99999) {
    throw new BadRequestError("Invalid amount");
  }

  // Find the beneficiary account
  let speiSettings;
  try {
    speiSettings = $app.findRecordById("spei_settings", speiSettingsId);
  } catch (_) {
    throw new NotFoundError("spei_settings not found");
  }

  if (!speiSettings.getBool("is_active")) {
    throw new BadRequestError("This beneficiary account is not active");
  }

  // Create the order record
  let order;
  $app.runInTransaction((txApp) => {
    const ordersCollection = txApp.findCollectionByNameOrId("spei_orders");
    order = new Record(ordersCollection);
    if (userId) {
      order.set("user", userId);
    }
    order.set("reference_collection", referenceCollection);
    order.set("reference_id", referenceId);
    order.set("amount", amount);
    order.set("currency", "MXN");
    order.set("status", "PENDING");
    order.set("spei_settings", speiSettings.id);
    order.set("cuenta_beneficiaria", speiSettings.getString("clabe"));
    txApp.save(order);
  });

  $app.logger().info(
    "[SPEI] Order created",
    "order_id", order.id,
    "amount", amount,
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
