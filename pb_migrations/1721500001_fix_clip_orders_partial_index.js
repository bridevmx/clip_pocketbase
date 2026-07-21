/// <reference path="../pb_data/types.d.ts" />
// Fixes the unique index on clip_orders.clip_payment_request_id.
//
// The original index was a full unique index, which rejects multiple rows
// with an empty string value — breaking order creation before the Clip API
// responds with a real payment_request_id.
//
// Replaced with a partial unique index that only enforces uniqueness when
// the field is non-empty, allowing concurrent PENDING_LINK orders.
migrate((app) => {
  app.db()
    .newQuery("DROP INDEX IF EXISTS idx_clip_orders_payment_request_id")
    .execute();

  app.db()
    .newQuery(
      "CREATE UNIQUE INDEX idx_clip_orders_payment_request_id " +
      "ON clip_orders (clip_payment_request_id) " +
      "WHERE clip_payment_request_id != ''"
    )
    .execute();
}, (app) => {
  // Revert to the original (broken) full unique index.
  app.db()
    .newQuery("DROP INDEX IF EXISTS idx_clip_orders_payment_request_id")
    .execute();

  app.db()
    .newQuery(
      "CREATE UNIQUE INDEX idx_clip_orders_payment_request_id " +
      "ON clip_orders (clip_payment_request_id)"
    )
    .execute();
});
