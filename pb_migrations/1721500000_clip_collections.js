/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // ─── clip_orders ────────────────────────────────────────────────────────
  // NOTE: PocketBase does NOT auto-add created/updated when collections are
  // created via migrations (only the Admin UI does that). They must be
  // declared explicitly here as autodate fields.

  // Resolve the users collection ID dynamically instead of hardcoding
  // "_pb_users_auth_", which is not portable across PocketHost and other
  // environments where the internal ID may differ.
  let usersCollectionId = null;
  try {
    const usersCollection = app.findCollectionByNameOrId("users");
    usersCollectionId = usersCollection.id;
  } catch (_) {
    // No users collection exists in this project — the user field will be
    // omitted and guest-only checkouts will still work correctly.
  }

  // Build the fields array, conditionally including the user relation.
  const orderFields = [
    { name: "reference_collection", type: "text", required: true },
    { name: "reference_id",         type: "text", required: true },
    { name: "amount",               type: "number", required: true },
    { name: "currency",             type: "text", required: true },
    {
      name: "status",
      type: "select",
      maxSelect: 1,
      values: ["PENDING_LINK", "CREATED", "PENDING", "COMPLETED", "CANCELED", "EXPIRED", "ERROR_CLIP"],
    },
    { name: "clip_payment_request_id", type: "text" },
    { name: "clip_payment_url",        type: "url" },
    { name: "clip_raw_status",         type: "text" },
    { name: "receipt_no",              type: "text" },
    { name: "amount_paid",             type: "number" },
    { name: "paid_at",                 type: "date" },
    { name: "canceled_at",             type: "date" },
    // Timestamp fields — must be declared explicitly in migrations.
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true  },
  ];

  if (usersCollectionId) {
    // Insert the user relation right after reference_id (index 2).
    orderFields.splice(2, 0, {
      name: "user",
      type: "relation",
      collectionId: usersCollectionId,
      required: false,
      maxSelect: 1,
    });
  }

  const orders = new Collection({
    type: "base",
    name: "clip_orders",
    fields: orderFields,
    indexes: [
      // Partial unique index: enforces uniqueness only when the field has a
      // non-empty value. This allows multiple orders to have an empty
      // clip_payment_request_id while the order record is being created
      // (before the Clip API responds with the real ID).
      "CREATE UNIQUE INDEX idx_clip_orders_payment_request_id ON clip_orders (clip_payment_request_id) WHERE clip_payment_request_id != ''",
    ],
  });
  app.save(orders);

  // ─── clip_payments (raw event audit log) ───────────────────────────────
  const payments = new Collection({
    type: "base",
    name: "clip_payments",
    fields: [
      { name: "order",               type: "relation", collectionId: orders.id, required: true, maxSelect: 1 },
      { name: "raw_webhook_payload", type: "json" },
      { name: "raw_api_response",    type: "json" },
      { name: "received_at",         type: "date", required: true },
      // Timestamp fields — must be declared explicitly in migrations.
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true  },
    ],
  });
  app.save(payments);

}, (app) => {
  try {
    const payments = app.findCollectionByNameOrId("clip_payments");
    app.delete(payments);
  } catch (_) {}
  try {
    const orders = app.findCollectionByNameOrId("clip_orders");
    app.delete(orders);
  } catch (_) {}
});
