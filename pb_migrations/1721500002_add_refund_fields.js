/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// Migration: Add refund tracking fields to clip_orders.
// Created: 2026-07-21
// ─────────────────────────────────────────────────────────────────────────

migrate((app) => {
  const orders = app.findCollectionByNameOrId("clip_orders");

  // Add new fields to the collection's fields array
  orders.fields.add(new Field({
    name: "refund_id",
    type: "text",
    required: false,
  }));

  orders.fields.add(new Field({
    name: "refund_status",
    type: "select",
    maxSelect: 1,
    values: ["PENDING", "APPROVED", "DECLINED"],
    required: false,
  }));

  orders.fields.add(new Field({
    name: "refund_amount",
    type: "number",
    required: false,
  }));

  orders.fields.add(new Field({
    name: "refunded_at",
    type: "date",
    required: false,
  }));

  orders.fields.add(new Field({
    name: "last_status_check",
    type: "date",
    required: false,
  }));

  app.save(orders);
}, (app) => {
  // Rollback: remove added fields
  const orders = app.findCollectionByNameOrId("clip_orders");
  
  const fieldsToRemove = ["refund_id", "refund_status", "refund_amount", "refunded_at", "last_status_check"];
  for (const fieldName of fieldsToRemove) {
    try {
      orders.fields.remove(fieldName);
    } catch (_) {}
  }
  
  app.save(orders);
});
