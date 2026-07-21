/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // ─── clip_orders ────────────────────────────────────────────────────────
  // NOTE: PocketBase does NOT auto-add created/updated when collections are
  // created via migrations (only the Admin UI does that). They must be
  // declared explicitly here as autodate fields.
  const orders = new Collection({
    type: "base",
    name: "clip_orders",
    fields: [
      { name: "reference_collection", type: "text", required: true },
      { name: "reference_id", type: "text", required: true },
      { name: "user", type: "relation", collectionId: "_pb_users_auth_", required: false, maxSelect: 1 },
      { name: "amount", type: "number", required: true },
      { name: "currency", type: "text", required: true },
      {
        name: "status",
        type: "select",
        maxSelect: 1,
        values: ["PENDING_LINK", "CREATED", "PENDING", "COMPLETED", "CANCELED", "EXPIRED", "ERROR_CLIP"],
      },
      { name: "clip_payment_request_id", type: "text" },
      { name: "clip_payment_url", type: "url" },
      { name: "clip_raw_status", type: "text" },
      { name: "receipt_no", type: "text" },
      { name: "amount_paid", type: "number" },
      { name: "paid_at", type: "date" },
      { name: "canceled_at", type: "date" },
      // Timestamp fields — must be declared explicitly in migrations.
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_clip_orders_payment_request_id ON clip_orders (clip_payment_request_id)",
    ],
  });
  app.save(orders);

  // ─── clip_payments (raw event audit log) ───────────────────────────────
  const payments = new Collection({
    type: "base",
    name: "clip_payments",
    fields: [
      { name: "order", type: "relation", collectionId: orders.id, required: true, maxSelect: 1 },
      { name: "raw_webhook_payload", type: "json" },
      { name: "raw_api_response", type: "json" },
      { name: "received_at", type: "date", required: true },
      // Timestamp fields — must be declared explicitly in migrations.
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
  });
  app.save(payments);
}, (app) => {
  const payments = app.findCollectionByNameOrId("clip_payments");
  app.delete(payments);
  const orders = app.findCollectionByNameOrId("clip_orders");
  app.delete(orders);
});
