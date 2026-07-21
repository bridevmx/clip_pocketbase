/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// Migration: Add refund tracking fields to clip_orders.
// Created: 2026-07-21
// ─────────────────────────────────────────────────────────────────────────

migrate((app) => {
  const orders = app.findCollectionByNameOrId("clip_orders");

  // refund_id — Clip's unique refund identifier
  app.addField(orders, {
    name: "refund_id",
    type: "text",
    required: false,
  });

  // refund_status — PENDING | APPROVED | DECLINED
  app.addField(orders, {
    name: "refund_status",
    type: "select",
    maxSelect: 1,
    values: ["PENDING", "APPROVED", "DECLINED"],
    required: false,
  });

  // refund_amount — Amount refunded in MXN
  app.addField(orders, {
    name: "refund_amount",
    type: "number",
    required: false,
  });

  // refunded_at — Timestamp of the refund
  app.addField(orders, {
    name: "refunded_at",
    type: "date",
    required: false,
  });

  // last_status_check — Last manual status verification timestamp
  app.addField(orders, {
    name: "last_status_check",
    type: "date",
    required: false,
  });

  app.save(orders);
}, (app) => {
  // Rollback: remove added fields
  const orders = app.findCollectionByNameOrId("clip_orders");
  app.removeField(orders, "refund_id");
  app.removeField(orders, "refund_status");
  app.removeField(orders, "refund_amount");
  app.removeField(orders, "refunded_at");
  app.removeField(orders, "last_status_check");
  app.save(orders);
});
