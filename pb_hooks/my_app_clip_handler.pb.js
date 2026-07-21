/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// YOUR BUSINESS LOGIC — this file is NOT part of the Clip plugin.
// Edit it freely. It runs whenever a clip_order changes state.
//
// The fields available on the clip_order record:
//   - status              (CREATED | PENDING | COMPLETED | CANCELED | EXPIRED)
//   - reference_collection (the name of your host collection, e.g. "products")
//   - reference_id         (the record ID in that collection)
//   - user                 (the PocketBase user ID, or empty for guest checkouts)
//   - amount / amount_paid / receipt_no / paid_at / canceled_at
// ─────────────────────────────────────────────────────────────────────────

onRecordAfterUpdateSuccess((e) => {
    const status = e.record.getString("status");

    if (status === "COMPLETED") {
        const refCollection = e.record.getString("reference_collection");
        const refId = e.record.getString("reference_id");
        const userId = e.record.getString("user");

        $app.logger().info(
            "Payment completed — run your business activation logic here",
            "reference_collection", refCollection,
            "reference_id", refId,
            "user", userId || "guest"
        );

        // TODO: add your logic here, for example:
        //   - activate a product / subscription
        //   - send a confirmation email
        //   - unlock a trip or order in your own collection
    }

    e.next();
}, "clip_orders");
