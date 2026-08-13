# Plugin Endpoints, Collections & Integration Guide

This guide explains how to use the HTTP API endpoints, collections, and custom hooks provided by the **Clip + SPEI Payments Plugin**.

---

## 1. Plugin Endpoints Summary

### Clip Payment Endpoints

| Method | Endpoint | Auth Level | Purpose |
|---|---|---|---|
| `POST` | `/api/clip/create-link` | Public / User | Generates a Clip Checkout link & creates an order |
| `POST` | `/api/clip/webhook?token=<secret>` | Webhook Secret | Handles payment callbacks from Clip |
| `GET`  | `/api/clip/order/{id}/status` | Owner / Superuser | Checks current status of a Clip order |
| `POST` | `/api/clip/refund` | Admin / Superuser | Issues full or partial refund for a transaction |
| `GET`  | `/api/clip/transaction/{receipt}` | Admin / Superuser | Fetches raw transaction details from Clip |

### SPEI Transfer Endpoints

| Method | Endpoint | Auth Level | Purpose |
|---|---|---|---|
| `POST` | `/api/spei/create-order` | Public / User | Creates a SPEI payment order & returns bank CLABE info |
| `POST` | `/api/spei/report-payment` | Public / User | Reports a bank transfer (submits tracking key/CLABE) |
| `GET`  | `/api/spei/order/{id}/status` | Owner / Superuser | Checks SPEI order status & CEP verification state |
| `POST` | `/api/spei/validate-cep` | Admin / Superuser | Manually triggers Banxico CEP validation for an order |

### Plugin Setup & Health Endpoints

| Method | Endpoint | Auth Level | Purpose |
|---|---|---|---|
| `GET`  | `/setup` | Public | Web Setup Wizard UI |
| `GET`  | `/api/plugin/setup-status` | Public | Returns `{ is_configured: boolean }` |
| `POST` | `/api/plugin/setup` | Superuser | Saves credentials & activates plugin |

---

## 2. Detailed Endpoint Usage

### `POST /api/clip/create-link`

Creates a Clip Checkout payment link.

#### Request Payload:
```json
{
  "reference_collection": "customer_orders",
  "reference_id": "ORD-123456",
  "amount": 250.00,
  "redirection_url": {
    "success": "https://myapp.com/order/success",
    "error": "https://myapp.com/order/error",
    "default": "https://myapp.com/order"
  }
}
```

#### Response (200 OK):
```json
{
  "success": true,
  "order_id": "rec_abc123xyz",
  "payment_request_id": "2d9b62ef-...",
  "payment_url": "https://payclip.com/checkout/2d9b62ef-...",
  "amount": 250.00,
  "status": "PENDING"
}
```

---

### `POST /api/spei/create-order`

Creates a SPEI transfer order and returns the active bank account (CLABE) for payment.

#### Request Payload:
```json
{
  "reference_collection": "customer_orders",
  "reference_id": "ORD-123456",
  "amount": 500.00
}
```

#### Response (200 OK):
```json
{
  "success": true,
  "order_id": "spei_rec999",
  "amount": 500.00,
  "status": "PENDING",
  "bank_info": {
    "bank_name": "BBVA",
    "beneficiary": "Mi Empresa S.A. de C.V.",
    "clabe": "012180001234567890"
  }
}
```

---

### `POST /api/spei/report-payment`

Submits payment proof after making a SPEI transfer.

#### Request Payload:
```json
{
  "order_id": "spei_rec999",
  "clave_rastreo": "20260813400123456789",
  "payer_clabe": "012180009876543210",
  "payer_bank": "STP",
  "amount": 500.00,
  "payment_date": "2026-08-13"
}
```

#### Response (200 OK):
```json
{
  "success": true,
  "status": "PENDING_MATCH",
  "message": "Payment reported. Banxico CEP verification in progress."
}
```

---

## 3. How to Connect Your Custom Business Logic ("My Hooks")

The plugin is designed to be **domain-agnostic**. It handles payments and status updates, but does **NOT** touch your custom tables (e.g. unlocking subscriptions, marking items as shipped, sending emails).

To add custom business logic, edit the two pre-wired handler files:

### Clip Handler (`pb_hooks/my_app_clip_handler.pb.js`)

This hook automatically fires whenever a `clip_orders` record is updated to `COMPLETED`:

```javascript
onRecordAfterUpdateSuccess((e) => {
  var record = e.record;
  var status = record.getString("status");

  // Only act when status becomes COMPLETED
  if (status !== "COMPLETED") return;

  var refCollection = record.getString("reference_collection");
  var refId = record.getString("reference_id");

  // YOUR CUSTOM BUSINESS LOGIC HERE:
  if (refCollection === "customer_orders") {
    var order = $app.findRecordById("customer_orders", refId);
    order.set("is_paid", true);
    order.set("status", "PAID");
    $app.save(order);
  }
}, "clip_orders");
```

---

### SPEI Handler (`pb_hooks/my_app_spei_handler.pb.js`)

This hook fires when a `spei_orders` record is verified and marked `LIQUIDADO` by Banxico:

```javascript
onRecordAfterUpdateSuccess((e) => {
  var record = e.record;
  var status = record.getString("status");

  // Only act when transfer is verified as LIQUIDADO
  if (status !== "LIQUIDADO") return;

  var refCollection = record.getString("reference_collection");
  var refId = record.getString("reference_id");

  // YOUR CUSTOM BUSINESS LOGIC HERE:
  var order = $app.findRecordById(refCollection, refId);
  order.set("status", "PAID_SPEI");
  $app.save(order);
}, "spei_orders");
```

---

## 4. Database Collections Created by Plugin

The plugin creates and maintains the following collections automatically via migrations:

| Collection | Type | Purpose | API Rules |
|---|---|---|---|
| `clip_orders` | Base | Tracks Clip payment links & statuses | Locked (`null`) |
| `clip_payments` | Base | Log of Clip transaction receipts | Locked (`null`) |
| `spei_orders` | Base | Tracks SPEI transfer intents | Locked (`null`) |
| `spei_settings` | Base | Active bank accounts (CLABE, Beneficiary) | Superuser only |
| `spei_banks` | Base | Catalog of ~100 Mexican bank codes | Read-only |
| `cep_verifications` | Base | Banxico CEP verification logs | Locked (`null`) |
| `plugin_settings` | Base | Credentials (`clip_api_key`, `pb_url`, secrets) | Locked (`null`) |
