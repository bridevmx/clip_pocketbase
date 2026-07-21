/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// YOUR BUSINESS LOGIC — this file is NOT part of the Clip plugin.
// Edit it freely. It runs whenever a clip_order changes state.
//
// The fields available on the clip_order record:
//   - status              (CREATED | PENDING | COMPLETED | CANCELED | EXPIRED | ERROR_CLIP)
//   - reference_collection (the name of your host collection, e.g. "products")
//   - reference_id         (the record ID in that collection)
//   - user                 (the PocketBase user ID, or empty for guest checkouts)
//   - amount / amount_paid / receipt_no / paid_at / canceled_at
// ─────────────────────────────────────────────────────────────────────────

onRecordAfterUpdateSuccess((e) => {
    const status = e.record.getString("status");
    const orderId = e.record.id;
    const refCollection = e.record.getString("reference_collection");
    const refId = e.record.getString("reference_id");

    // Console.log shows in PocketHost instance logs for debugging.
    console.log(`[CLIP ORDER] Order ${orderId} → status: ${status} | ref: ${refCollection}:${refId}`);

    if (status === "COMPLETED") {
        const userId    = e.record.getString("user");
        const receiptNo = e.record.getString("receipt_no");
        const amountPaid = e.record.get("amount_paid");

        console.log(`[CLIP ORDER] ✓ PAYMENT COMPLETED — receipt: ${receiptNo}, amount: ${amountPaid}, user: ${userId || "guest"}`);

        // TODO: add your business logic here, for example:
        //   - activate a product / subscription
        //   - send a confirmation email
        //   - unlock a trip or order in your own collection
    }

    if (status === "CANCELED") {
        console.log(`[CLIP ORDER] ✗ PAYMENT CANCELED for order ${orderId}`);
    }

    if (status === "EXPIRED") {
        console.log(`[CLIP ORDER] ⏱ PAYMENT EXPIRED for order ${orderId}`);
    }

    if (status === "ERROR_CLIP") {
        console.log(`[CLIP ORDER] ⚠ CLIP API ERROR for order ${orderId}`);
    }

    e.next();
}, "clip_orders");
