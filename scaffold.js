#!/usr/bin/env node
// scaffold-clip-plugin.js
// Genera el plugin completo de Clip México para PocketBase.
// Uso: node scaffold-clip-plugin.js

const fs = require("fs");
const path = require("path");

function writeFile(relPath, content) {
  const fullPath = path.join(process.cwd(), relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
  console.log(`✅ Creado: ${relPath}`);
}

// ─────────────────────────────────────────────────────────────────────────
// 1. MIGRACIÓN: crea las colecciones clip_orders y clip_payments
// ─────────────────────────────────────────────────────────────────────────
writeFile(
  "pb_migrations/1721500000_clip_collections.js",
  `/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // ─── clip_orders ────────────────────────────────────────────────────────
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
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_clip_orders_payment_request_id ON clip_orders (clip_payment_request_id)",
    ],
  });
  app.save(orders);

  // ─── clip_payments (bitácora de eventos crudos, auditoría) ─────────────
  const payments = new Collection({
    type: "base",
    name: "clip_payments",
    fields: [
      { name: "order", type: "relation", collectionId: orders.id, required: true, maxSelect: 1 },
      { name: "raw_webhook_payload", type: "json" },
      { name: "raw_api_response", type: "json" },
      { name: "received_at", type: "date", required: true },
    ],
  });
  app.save(payments);
}, (app) => {
  const payments = app.findCollectionByNameOrId("clip_payments");
  app.delete(payments);
  const orders = app.findCollectionByNameOrId("clip_orders");
  app.delete(orders);
});
`
);

// ─────────────────────────────────────────────────────────────────────────
// 2. BOOTSTRAP: mensaje de consola con la ruta exacta a modificar
// ─────────────────────────────────────────────────────────────────────────
writeFile(
  "pb_hooks/clip_00_bootstrap.pb.js",
  `/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
//  CLIP PAYMENT PLUGIN — Archivo de referencia (NO EDITAR)
// ─────────────────────────────────────────────────────────────────────────
// Este plugin NO conoce tu modelo de negocio. Solo gestiona:
//   - Colección: clip_orders   (orden de cobro genérica)
//   - Colección: clip_payments (bitácora de eventos)
//   - Ruta:      POST /api/clip/create-link
//   - Ruta:      POST /api/clip/webhook
//
// Para conectar tu lógica de negocio (activar producto, mandar email,
// desbloquear acceso, etc.), NO edites los archivos clip_*.pb.js.
// Crea/edita en su lugar:
//
//     pb_hooks/my_app_clip_handler.pb.js
//
// ─────────────────────────────────────────────────────────────────────────

onBootstrap((e) => {
    e.next();
    console.log("");
    console.log("🔌 [CLIP PLUGIN] Cargado correctamente.");
    console.log("🔌 [CLIP PLUGIN] Colecciones esperadas: clip_orders, clip_payments");
    console.log("🔌 [CLIP PLUGIN] Rutas activas: POST /api/clip/create-link, POST /api/clip/webhook");
    console.log("🔌 [CLIP PLUGIN] Ruta exacta para tu lógica de negocio ->");
    console.log("🔌 [CLIP PLUGIN]   pb_hooks/my_app_clip_handler.pb.js");
    console.log("🔌 [CLIP PLUGIN] Escucha: onRecordAfterUpdateSuccess((e) => {...}, \\"clip_orders\\")");
    console.log("");
});
`
);

// ─────────────────────────────────────────────────────────────────────────
// 3. WEBHOOK: recibe la señal de Clip, consulta el estado real, actualiza clip_orders
// ─────────────────────────────────────────────────────────────────────────
writeFile(
  "pb_hooks/clip_webhook.pb.js",
  `/// <reference path="../pb_data/types.d.ts" />
// Clip no expone firma HMAC verificable en el webhook público.
// Estrategia de seguridad: el webhook solo dispara una re-consulta del
// estado real vía GET /checkout/{id}; nunca confiamos en el payload solo.

function consultarPagoClip(paymentRequestId) {
  const apiKey = $os.getenv("CLIP_API_KEY");
  if (!apiKey) throw new Error("CLIP_API_KEY no configurada");

  const credentials = btoa(\`\${apiKey}:\`);
  const res = $http.send({
    method: "GET",
    url: \`https://api.payclip.com/v1/checkout/\${paymentRequestId}\`,
    headers: { Authorization: \`Basic \${credentials}\`, "Content-Type": "application/json" },
    timeout: 15,
  });

  if (res.statusCode !== 200) {
    throw new Error(\`Clip API error \${res.statusCode}: \${res.raw}\`);
  }
  return res.json;
}

routerAdd("POST", "/api/clip/webhook", (e) => {
  const body = e.requestInfo().body;

  if (!body || !body["id"] || !body["origin"] || !body["event_type"]) {
    $app.logger().error("Clip webhook: payload inválido", "body", JSON.stringify(body));
    throw new BadRequestError("Payload inválido");
  }

  const paymentRequestId = body["id"];
  const origin = body["origin"];

  $app.logger().info("Clip webhook recibido", "id", paymentRequestId, "origin", origin);

  if (origin !== "checkout-api") {
    return e.json(200, { status: "ignored" });
  }

  let clipPayment;
  try {
    clipPayment = consultarPagoClip(paymentRequestId);
  } catch (err) {
    $app.logger().error("Clip webhook: error consultando API", "error", err.message);
    return e.json(200, { status: "error_consultando_api" });
  }

  const resourceStatus = clipPayment["resource_status"];
  const receiptNo = clipPayment["receipt_no"] || null;
  const amountPaid = clipPayment["amount"] || 0;

  let orders;
  try {
    orders = $app.findRecordsByFilter(
      "clip_orders",
      \`clip_payment_request_id="\${paymentRequestId}"\`,
      "-created", 1, 0
    );
  } catch (err) {
    return e.json(200, { status: "orden_no_encontrada" });
  }

  if (!orders || orders.length === 0) {
    return e.json(200, { status: "sin_orden" });
  }

  const order = orders[0];
  if (order.getString("status") === "COMPLETED") {
    return e.json(200, { status: "ya_procesada" });
  }

  $app.runInTransaction((txApp) => {
    order.set("status", resourceStatus);
    order.set("clip_raw_status", resourceStatus);

    if (resourceStatus === "COMPLETED") {
      order.set("paid_at", new Date().toISOString());
      order.set("receipt_no", receiptNo);
      order.set("amount_paid", amountPaid);
    } else if (resourceStatus === "CANCELED" || resourceStatus === "EXPIRED") {
      order.set("canceled_at", new Date().toISOString());
    }
    txApp.save(order);

    const paymentsCollection = txApp.findCollectionByNameOrId("clip_payments");
    const log = new Record(paymentsCollection);
    log.set("order", order.id);
    log.set("raw_webhook_payload", body);
    log.set("raw_api_response", clipPayment);
    log.set("received_at", new Date().toISOString());
    txApp.save(log);
  });

  return e.json(200, { status: "ok", processed_status: resourceStatus });
});
`
);

// ─────────────────────────────────────────────────────────────────────────
// 4. CREATE-LINK: expone endpoint para generar el link de pago
// ─────────────────────────────────────────────────────────────────────────
writeFile(
  "pb_hooks/clip_create_link.pb.js",
  `/// <reference path="../pb_data/types.d.ts" />
routerAdd("POST", "/api/clip/create-link", (e) => {
  const info = e.requestInfo();
  if (!info.auth) throw new UnauthorizedError("Se requiere autenticación");

  const body = info.body;
  const amount = body["amount"];
  const referenceCollection = body["reference_collection"];
  const referenceId = body["reference_id"];
  const userId = info.auth.id;

  if (!amount || !referenceCollection || !referenceId) {
    throw new BadRequestError("amount, reference_collection y reference_id son requeridos");
  }
  if (amount <= 0 || amount > 99999) {
    throw new BadRequestError("Monto inválido");
  }

  const apiKey = $os.getenv("CLIP_API_KEY");
  const webhookBaseUrl = $os.getenv("POCKETBASE_URL");

  let order;
  $app.runInTransaction((txApp) => {
    const ordersCollection = txApp.findCollectionByNameOrId("clip_orders");
    order = new Record(ordersCollection);
    order.set("user", userId);
    order.set("reference_collection", referenceCollection);
    order.set("reference_id", referenceId);
    order.set("amount", amount);
    order.set("currency", "MXN");
    order.set("status", "PENDING_LINK");
    txApp.save(order);
  });

  const credentials = btoa(\`\${apiKey}:\`);
  const clipRes = $http.send({
    method: "POST",
    url: "https://api.payclip.com/v1/checkout",
    headers: { Authorization: \`Basic \${credentials}\`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: amount,
      currency: "MXN",
      webhook_url: \`\${webhookBaseUrl}/api/clip/webhook\`,
      metadata: { order_id: order.id, user_id: userId },
    }),
    timeout: 20,
  });

  if (clipRes.statusCode !== 200 && clipRes.statusCode !== 201) {
    $app.logger().error("Error creando link en Clip API", "status", clipRes.statusCode, "response", clipRes.raw);
    order.set("status", "ERROR_CLIP");
    $app.save(order);
    throw new Error(\`Error de Clip: \${clipRes.statusCode}\`);
  }

  const clipData = clipRes.json;
  order.set("clip_payment_request_id", clipData["payment_request_id"]);
  order.set("clip_payment_url", clipData["payment_url"]);
  order.set("status", "CREATED");
  $app.save(order);

  return e.json(200, {
    order_id: order.id,
    payment_url: clipData["payment_url"],
    payment_request_id: clipData["payment_request_id"],
    status: "CREATED",
  });
});
`
);

// ─────────────────────────────────────────────────────────────────────────
// 5. HANDLER DE NEGOCIO (plantilla vacía, fuera del plugin)
// ─────────────────────────────────────────────────────────────────────────
writeFile(
  "pb_hooks/my_app_clip_handler.pb.js",
  `/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// TU LÓGICA DE NEGOCIO — este archivo NO es parte del plugin de Clip.
// Edítalo libremente. Se ejecuta cuando una clip_order cambia de estado.
// ─────────────────────────────────────────────────────────────────────────

onRecordAfterUpdateSuccess((e) => {
    const status = e.record.getString("status");

    if (status === "COMPLETED") {
        const refCollection = e.record.getString("reference_collection");
        const refId = e.record.getString("reference_id");
        const userId = e.record.getString("user");

        $app.logger().info(
            "✅ Pago completado, activar lógica de negocio",
            "reference_collection", refCollection,
            "reference_id", refId,
            "user", userId
        );

        // TODO: aquí tu lógica -> activar producto, mandar email,
        // desbloquear un viaje, marcar un pedido de repostería como pagado, etc.
    }

    e.next();
}, "clip_orders");
`
);

// ─────────────────────────────────────────────────────────────────────────
// 6. CONTEXT.md — glosario de dominio (regla de /grill-with-docs)
// ─────────────────────────────────────────────────────────────────────────
writeFile(
  "docs/CONTEXT.md",
  `# CONTEXT.md — Domain Glossary: Clip Payments Plugin

> Generated by /grill-with-docs session. Only defines terms, not implementation.

- **Order (\`clip_orders\`)**: central entity of the plugin. Represents a charge intent, independent of whether it has been paid.
- **Payment Link**: external Clip mechanism to charge an Order. It is not the source of truth for payment status.
- **Payment**: evidence of settlement. It is confirmed only by querying \`GET /checkout/{id}\` on the Clip API, never trusting the webhook payload alone.
- **Activation**: business logic effect post-payment (unlock product, trip, order). Lives **outside** the plugin.
- **Generic Reference**: pair of fields \`reference_collection\` + \`reference_id\` in \`clip_orders\`. The plugin does not assume any host-specific collection (e.g. \`products\`).
- **Plugin**: set of files \`pb_hooks/clip_*.pb.js\` + \`pb_migrations/*.js\`, deployable on any PocketBase project without editing them.
- **Business Handler**: file \`pb_hooks/my_app_clip_handler.pb.js\`, outside the plugin, listens to \`onRecordAfterUpdateSuccess\` on \`clip_orders\`.
`
);

// ─────────────────────────────────────────────────────────────────────────
// 7. ADRs — decisiones difíciles de revertir
// ─────────────────────────────────────────────────────────────────────────
writeFile(
  "docs/adr/0001-installation-via-migrations.md",
  `# ADR 0001: Installation via pb_migrations, not manual schema import

## Context
The reference repository (pocketbase_stripe) required importing a \`pb_schema.json\` manually from the Admin UI. This contradicts the "upload and automatic run" requirement.

## Decision
The collections \`clip_orders\` and \`clip_payments\` are created via \`pb_migrations/*.js\`, which PocketBase runs automatically at startup.

## Consequences
- Zero manual steps in the Admin UI.
- Versionable in Git, consistent with the user's workflow.
- Requires discipline: never edit collections manually or future migrations might desync.
`
);

writeFile(
  "docs/adr/0002-generic-reference-by-text.md",
  `# ADR 0002: Generic reference by text instead of typed relation

## Context
The plugin must work across multiple user SaaS applications (e-commerce, transport, bakery), each with a different "purchased item" model.

## Decision
\`clip_orders\` uses \`reference_collection\` (text) + \`reference_id\` (text) instead of a typed PocketBase relation to a \`products\` collection.

## Consequences
- The plugin never depends on specific host collections.
- Referential integrity is not validated at the DB level; it is handled by the business handler.
- Total portability across projects.
`
);

writeFile(
  "docs/adr/0003-extension-via-native-hook.md",
  `# ADR 0003: Business extension via native hook on clip_orders

## Context
The plugin must not know the business logic (activate product, etc.), but the host needs to react to payment status changes.

## Decision
We use \`onRecordAfterUpdateSuccess(..., "clip_orders")\` in a separate file (\`my_app_clip_handler.pb.js\`), never edited by the plugin.

## Consequences
- No new infrastructure introduced (no internal webhooks or custom events).
- The file \`clip_00_bootstrap.pb.js\` logs the exact path in the console on boot so developers never forget it.
- If the host doesn't create the handler file, nothing happens after payment — a silent failure mitigated by the console boot message.
`
);

// ─────────────────────────────────────────────────────────────────────────
// 8. README.md — descripción y uso
// ─────────────────────────────────────────────────────────────────────────
writeFile(
  "README.md",
  `# pocketbase-clip-mx

A portable PocketBase plugin to integrate payments via Clip México payment links (Checkout API).

## Installation

1. Copy \`pb_hooks/\` files to your PocketBase \`pb_hooks/\` directory.
2. Copy \`pb_migrations/\` files to your PocketBase \`pb_migrations/\` directory.
3. Configure environment variables.
4. Restart PocketBase.

## Configuration

Required environment variables:
- \`CLIP_API_KEY\`: Your Clip checkout API key.
- \`POCKETBASE_URL\`: Your PocketBase application public URL (e.g. \`https://my-app.com\`).
`
);

console.log("\\n🎉 Clip México plugin files generated successfully.");
