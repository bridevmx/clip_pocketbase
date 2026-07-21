/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// YOUR BUSINESS LOGIC — this file is NOT part of the Clip plugin.
// Edit it freely. It runs whenever a clip_order changes state.
//
// Fields available on the clip_order record:
//   - status              (CREATED | PENDING | COMPLETED | CANCELED | EXPIRED | ERROR_CLIP)
//   - reference_collection (your host collection, e.g. "products", "orders", "subscriptions")
//   - reference_id         (the record ID in that collection)
//   - user                 (PocketBase user ID, or empty for guest checkouts)
//   - amount / amount_paid / receipt_no / paid_at / canceled_at
//
// How it works:
//   1. You create a record in YOUR collection (e.g. "orders")
//   2. You call POST /api/clip/create-link with reference_collection + reference_id
//   3. When Clip confirms payment, this handler fires
//   4. You look up YOUR record via reference_collection + reference_id
//   5. You perform your business logic (activate, ship, email, etc.)
// ─────────────────────────────────────────────────────────────────────────

onRecordAfterUpdateSuccess((e) => {
    const status = e.record.getString("status");
    const orderId = e.record.id;
    const refCollection = e.record.getString("reference_collection");
    const refId = e.record.getString("reference_id");

    console.log(`[CLIP ORDER] Order ${orderId} → status: ${status} | ref: ${refCollection}:${refId}`);

    // ─── PAYMENT COMPLETED ────────────────────────────────────────────
    if (status === "COMPLETED") {
        const userId    = e.record.getString("user");
        const receiptNo = e.record.getString("receipt_no");
        const amountPaid = e.record.get("amount_paid");

        console.log(`[CLIP ORDER] ✓ PAYMENT COMPLETED — receipt: ${receiptNo}, amount: ${amountPaid}, user: ${userId || "guest"}`);

        // ──────────────────────────────────────────────────────────────
        // EXAMPLE 1: Activate a product in your collection
        // ──────────────────────────────────────────────────────────────
        // const product = $app.findRecordById(refCollection, refId);
        // product.set("status", "active");
        // product.set("paid_at", new Date().toISOString());
        // product.set("clip_receipt", receiptNo);
        // $app.save(product);

        // ──────────────────────────────────────────────────────────────
        // EXAMPLE 2: Find the client from the product and send email
        // ──────────────────────────────────────────────────────────────
        // const product = $app.findRecordById(refCollection, refId);
        // const clientEmail = product.getString("client_email");
        // const clientName  = product.getString("client_name");
        //
        // // Send email using PocketBase's mailer
        // $app.newMailClient().send({
        //   from: { name: "My Store", address: "noreply@mystore.com" },
        //   to: [{ name: clientName, address: clientEmail }],
        //   subject: "Payment confirmed — order #" + refId,
        //   htmlBody: `
        //     <h1>Thank you, ${clientName}!</h1>
        //     <p>Your payment of $${amountPaid} MXN has been confirmed.</p>
        //     <p>Receipt: ${receiptNo}</p>
        //   `,
        // });

        // ──────────────────────────────────────────────────────────────
        // EXAMPLE 3: Unlock access (e.g. course, digital content)
        // ──────────────────────────────────────────────────────────────
        // if (userId) {
        //   const accessCollection = $app.findCollectionByNameOrId("user_access");
        //   const access = new Record(accessCollection);
        //   access.set("user", userId);
        //   access.set("product_id", refId);
        //   access.set("granted_at", new Date().toISOString());
        //   $app.save(access);
        // }

        // ──────────────────────────────────────────────────────────────
        // EXAMPLE 4: Update order status in your own collection
        // ──────────────────────────────────────────────────────────────
        // const order = $app.findRecordById(refCollection, refId);
        // order.set("payment_status", "paid");
        // order.set("clip_order_id", orderId);
        // order.set("clip_receipt", receiptNo);
        // order.set("paid_at", e.record.getString("paid_at"));
        // $app.save(order);
    }

    // ─── PAYMENT CANCELED ─────────────────────────────────────────────
    if (status === "CANCELED") {
        console.log(`[CLIP ORDER] ✗ PAYMENT CANCELED for order ${orderId}`);

        // Example: mark order as canceled
        // const order = $app.findRecordById(refCollection, refId);
        // order.set("payment_status", "canceled");
        // $app.save(order);
    }

    // ─── PAYMENT EXPIRED ──────────────────────────────────────────────
    if (status === "EXPIRED") {
        console.log(`[CLIP ORDER] ⏱ PAYMENT EXPIRED for order ${orderId}`);

        // Example: mark order as expired
        // const order = $app.findRecordById(refCollection, refId);
        // order.set("payment_status", "expired");
        // $app.save(order);
    }

    // ─── CLIP API ERROR ───────────────────────────────────────────────
    if (status === "ERROR_CLIP") {
        console.log(`[CLIP ORDER] ⚠ CLIP API ERROR for order ${orderId}`);

        // Example: notify admin
        // $app.newMailClient().send({
        //   from: { name: "Clip Plugin", address: "noreply@mystore.com" },
        //   to: [{ name: "Admin", address: "admin@mystore.com" }],
        //   subject: "Clip API error for order " + orderId,
        //   htmlBody: `<p>Order ${orderId} (ref: ${refCollection}:${refId}) failed at Clip API.</p>`,
        // });
    }

    e.next();
}, "clip_orders");
