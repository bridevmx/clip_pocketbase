/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // ─── spei_banks ─────────────────────────────────────────────────────────
  const banks = new Collection({
    type: "base",
    name: "spei_banks",
    listRule: "",
    viewRule: "",
    createRule: false,
    updateRule: false,
    deleteRule: false,
    fields: [
      { name: "bank_code", type: "text", required: true, options: { max: 10 } },
      { name: "bank_name", type: "text", required: true, options: { max: 100 } },
      { name: "is_active", type: "bool", required: false },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_spei_banks_code ON spei_banks (bank_code)",
    ],
  });
  app.save(banks);

  // ─── spei_settings ──────────────────────────────────────────────────────
  const settings = new Collection({
    type: "base",
    name: "spei_settings",
    listRule: "@request.auth.collectionName = '_superusers'",
    viewRule: "@request.auth.collectionName = '_superusers'",
    createRule: "@request.auth.collectionName = '_superusers'",
    updateRule: "@request.auth.collectionName = '_superusers'",
    deleteRule: "@request.auth.collectionName = '_superusers'",
    fields: [
      { name: "label", type: "text", required: true, options: { max: 100 } },
      { name: "clabe", type: "text", required: true, options: { max: 18 } },
      { name: "bank_code", type: "text", required: true, options: { max: 10 } },
      { name: "bank_name", type: "text", required: true, options: { max: 100 } },
      { name: "account_holder", type: "text", required: true, options: { max: 200 } },
      { name: "is_active", type: "bool", required: false },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_spei_settings_clabe ON spei_settings (clabe)",
      "CREATE INDEX idx_spei_settings_active ON spei_settings (is_active)",
    ],
  });
  app.save(settings);

  // ─── spei_orders ────────────────────────────────────────────────────────
  let usersCollectionId = null;
  try {
    const usersCollection = app.findCollectionByNameOrId("users");
    usersCollectionId = usersCollection.id;
  } catch (_) {}

  const orderFields = [
    { name: "reference_collection", type: "text", required: true },
    { name: "reference_id", type: "text", required: true },
    { name: "amount", type: "number", required: true },
    { name: "currency", type: "text", required: true, options: { max: 5 } },
    {
      name: "status",
      type: "select",
      required: true,
      maxSelect: 1,
      values: ["PENDING", "REPORTED", "LIQUIDADO", "REJECTED", "MANUAL_REVIEW", "EXPIRED"],
    },
    { name: "spei_settings", type: "relation", required: false, options: { collectionId: settings.id, cascadeDelete: false, maxSelect: 1 } },
    { name: "criterio", type: "text", options: { max: 30 } },
    { name: "emisor", type: "text", options: { max: 10 } },
    { name: "emisor_name", type: "text", options: { max: 100 } },
    { name: "cuenta_beneficiaria", type: "text", options: { max: 18 } },
    { name: "monto_declarado", type: "text", options: { max: 20 } },
    { name: "submitted_at", type: "date" },
    { name: "validated_at", type: "date" },
    { name: "retry_count", type: "number", required: false },
    { name: "next_retry_at", type: "date" },
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];

  if (usersCollectionId) {
    orderFields.splice(2, 0, {
      name: "user",
      type: "relation",
      required: false,
      options: { collectionId: usersCollectionId, cascadeDelete: false, maxSelect: 1 },
    });
  }

  const orders = new Collection({
    type: "base",
    name: "spei_orders",
    listRule: "@request.auth.collectionName = '_superusers'",
    viewRule: "@request.auth.collectionName = '_superusers'",
    createRule: "",
    updateRule: "@request.auth.collectionName = '_superusers'",
    deleteRule: "@request.auth.collectionName = '_superusers'",
    fields: orderFields,
    indexes: [
      "CREATE INDEX idx_spei_orders_status ON spei_orders (status)",
      "CREATE INDEX idx_spei_orders_ref ON spei_orders (reference_collection, reference_id)",
      "CREATE INDEX idx_spei_orders_retry ON spei_orders (next_retry_at, retry_count)",
    ],
  });
  app.save(orders);

  // ─── cep_verifications ──────────────────────────────────────────────────
  const cepVerifications = new Collection({
    type: "base",
    name: "cep_verifications",
    listRule: "@request.auth.collectionName = '_superusers'",
    viewRule: "@request.auth.collectionName = '_superusers'",
    createRule: false,
    updateRule: false,
    deleteRule: false,
    fields: [
      { name: "order", type: "relation", required: true, options: { collectionId: orders.id, cascadeDelete: false, maxSelect: 1 } },
      { name: "reference", type: "text", options: { max: 50 } },
      { name: "tracking_code", type: "text", options: { max: 50 } },
      { name: "issuing_bank", type: "text", options: { max: 200 } },
      { name: "receiving_bank", type: "text", options: { max: 200 } },
      { name: "status_name", type: "text", options: { max: 100 } },
      { name: "status_description", type: "text", options: { max: 500 } },
      { name: "reception_date", type: "text", options: { max: 50 } },
      { name: "processing_date", type: "text", options: { max: 50 } },
      { name: "beneficiary_account", type: "text", options: { max: 20 } },
      { name: "amount", type: "number" },
      { name: "validated_match", type: "bool" },
      { name: "mismatch_reason", type: "text", options: { max: 500 } },
      { name: "raw_response", type: "json" },
      { name: "validated_by", type: "text", options: { max: 100 } },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_cep_verifications_order ON cep_verifications (order)",
      "CREATE INDEX idx_cep_verifications_tracking ON cep_verifications (tracking_code)",
    ],
  });
  app.save(cepVerifications);

}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("cep_verifications")); } catch (_) {}
  try { app.delete(app.findCollectionByNameOrId("spei_orders")); } catch (_) {}
  try { app.delete(app.findCollectionByNameOrId("spei_settings")); } catch (_) {}
  try { app.delete(app.findCollectionByNameOrId("spei_banks")); } catch (_) {}
});
