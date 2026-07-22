/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// YOUR BUSINESS LOGIC — this file is NOT part of the SPEI plugin.
// Edit it freely. It runs whenever a spei_order changes state.
//
// Fields available on the spei_order record:
//   - status              (PENDING | REPORTED | LIQUIDADO | REJECTED | MANUAL_REVIEW | EXPIRED)
//   - reference_collection (your host collection, e.g. "products", "orders", "subscriptions")
//   - reference_id         (the record ID in that collection)
//   - user                 (PocketBase user ID, or empty for guest checkouts)
//   - amount / amount_paid / receipt_no / paid_at
//   - criterio / emisor / emisor_name
//
// How it works:
//   1. You create a record in YOUR collection (e.g. "orders")
//   2. You call POST /api/spei/create-order with reference_collection + reference_id
//   3. You show the user the CLABE to make the transfer
//   4. User reports payment via POST /api/spei/report-payment
//   5. Plugin validates CEP automatically
//   6. When status changes to LIQUIDADO, this handler fires
//   7. You perform your business logic (activate, ship, email, etc.)
// ─────────────────────────────────────────────────────────────────────────

onRecordAfterUpdateSuccess((e) => {
    const status = e.record.getString("status");
    const orderId = e.record.id;
    const refCollection = e.record.getString("reference_collection");
    const refId = e.record.getString("reference_id");

    console.log(`[SPEI ORDER] Order ${orderId} → status: ${status} | ref: ${refCollection}:${refId}`);

    // ─── PAYMENT LIQUIDADO ──────────────────────────────────────────────
    if (status === "LIQUIDADO") {
        const userId = e.record.getString("user");
        const amount = e.record.get("amount");

        console.log(`[SPEI ORDER] ✓ PAYMENT LIQUIDADO — amount: ${amount}, user: ${userId || "guest"}`);

        // ──────────────────────────────────────────────────────────────
        // EXAMPLE 1: Activate a product in your collection
        // ──────────────────────────────────────────────────────────────
        // const product = $app.findRecordById(refCollection, refId);
        // product.set("status", "active");
        // product.set("paid_at", new Date().toISOString());
        // $app.save(product);

        // ──────────────────────────────────────────────────────────────
        // EXAMPLE 2: Send confirmation email
        // ──────────────────────────────────────────────────────────────
        // const product = $app.findRecordById(refCollection, refId);
        // const clientEmail = product.getString("client_email");
        // $app.newMailClient().send({
        //   from: { name: "My Store", address: "noreply@mystore.com" },
        //   to: [{ name: "Customer", address: clientEmail }],
        //   subject: "Payment confirmed — SPEI transfer",
        //   htmlBody: `<h1>Thank you!</h1><p>Your payment of $${amount} MXN has been confirmed.</p>`,
        // });
    }

    // ─── PAYMENT REJECTED ──────────────────────────────────────────────
    if (status === "REJECTED") {
        console.log(`[SPEI ORDER] ✗ PAYMENT REJECTED for order ${orderId}`);

        // Example: notify admin
        // $app.newMailClient().send({
        //   from: { name: "SPEI Plugin", address: "noreply@mystore.com" },
        //   to: [{ name: "Admin", address: "admin@mystore.com" }],
        //   subject: "SPEI payment rejected for order " + orderId,
        //   htmlBody: `<p>Order ${orderId} (ref: ${refCollection}:${refId}) was rejected.</p>`,
        // });
    }

    // ─── MANUAL REVIEW ─────────────────────────────────────────────────
    if (status === "MANUAL_REVIEW") {
        console.log(`[SPEI ORDER] ⚠ MANUAL REVIEW required for order ${orderId}`);

        // Example: notify admin for manual review
        // $app.newMailClient().send({
        //   from: { name: "SPEI Plugin", address: "noreply@mystore.com" },
        //   to: [{ name: "Admin", address: "admin@mystore.com" }],
        //   subject: "SPEI payment needs manual review — order " + orderId,
        //   htmlBody: `<p>Order ${orderId} needs manual review. CEP validation inconclusive.</p>`,
        // });
    }

    // ─── EXPIRED ───────────────────────────────────────────────────────
    if (status === "EXPIRED") {
        console.log(`[SPEI ORDER] ⏱ PAYMENT EXPIRED for order ${orderId}`);
    }

    e.next();
}, "spei_orders");
