# 🇲🇽 pocketbase-clip-mx

> A drop-in payment plugin for any [PocketBase](https://pocketbase.io) project. Adds full **Clip México Checkout API** support — payment links, webhooks, and an audit log — with zero changes to your existing codebase.

[![PocketBase](https://img.shields.io/badge/PocketBase-v0.23%2B-blue?logo=pocketbase)](https://pocketbase.io)
[![Clip México](https://img.shields.io/badge/Clip%20M%C3%A9xico-Checkout%20API-orange)](https://developer.clip.mx/docs/api-de-checkout)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## ✨ What this plugin does

| Feature | Details |
|---|---|
| 🔗 **Payment links** | `POST /api/clip/create-link` creates a Clip payment link and stores a `clip_orders` record |
| 🪝 **Webhook handler** | `POST /api/clip/webhook` receives the Clip signal, re-queries the API for the real state, and updates `clip_orders` |
| 🗄️ **Auto migrations** | Creates `clip_orders` and `clip_payments` collections automatically on first boot — no Admin UI steps |
| 🔌 **Business extension point** | Fires `onRecordAfterUpdateSuccess` on `clip_orders` so your code reacts to payment events in a separate file |
| 👤 **Guest checkout** | Authentication is optional — orders can be created without a logged-in user |
| 🔁 **Automatic retries** | Returns HTTP 502 when the Clip API is unreachable so Clip retries webhook delivery automatically |

> **Design principle:** This plugin is intentionally blind to your business domain. It does not activate products, send emails, or know what a "product" is. You wire that logic yourself in `my_app_clip_handler.pb.js`.

---

## 📋 Requirements

- PocketBase **v0.23 or later** — uses `Buffer.from()` for Base64 encoding ([confirmed available](https://github.com/pocketbase/pocketbase/discussions/6651) by the PocketBase maintainer)
- A [Clip México developer account](https://developer.clip.mx) with a Checkout API key

---

## 🚀 Installation

This is a **file-only plugin** — no Dockerfile, no separate service, no npm packages. Copy the files into your existing PocketBase project and restart.

### 1. Copy the files

```
your-pocketbase-project/
├── pb_hooks/
│   ├── clip_00_bootstrap.pb.js     ← copy
│   ├── clip_api_client.pb.js       ← copy
│   ├── clip_create_link.pb.js      ← copy
│   ├── clip_webhook.pb.js          ← copy
│   └── my_app_clip_handler.pb.js   ← copy, then edit with your logic
└── pb_migrations/
    └── 1721500000_clip_collections.js  ← copy
```

### 2. Set environment variables

Add the two required variables to your deployment environment (details per platform below):

| Variable | Required | Description |
|---|---|---|
| `CLIP_API_KEY` | ✅ Yes | Your Clip Basic Auth token — the Base64-encoded string from your [Clip developer dashboard](https://developer.clip.mx), exactly as provided (i.e. `base64("CLAVE_API:CLAVE_SECRETA")`) |
| `POCKETBASE_URL` | ✅ Yes | Public URL of your PocketBase instance, **no trailing slash** — e.g. `https://pb.myapp.com` |

> ⚠️ **Never hardcode these values** in any plugin file or Dockerfile. They are credentials — keep them exclusively in your deployment environment.

### 3. Restart PocketBase

Migrations run automatically on startup. You will see this in the console when everything is ready:

```
[CLIP PLUGIN] ─────────────────────────────────────────
[CLIP PLUGIN] Loaded successfully.
[CLIP PLUGIN] Expected collections: clip_orders, clip_payments
[CLIP PLUGIN] Active routes: POST /api/clip/create-link, POST /api/clip/webhook
[CLIP PLUGIN] To add your business logic after payment, create/edit:
[CLIP PLUGIN]   -> pb_hooks/my_app_clip_handler.pb.js
[CLIP PLUGIN] ─────────────────────────────────────────
```

---

## ⚙️ Environment variables by platform

### 🟣 PocketHost

Go to your instance dashboard → **Secrets** tab → add:

```
CLIP_API_KEY=<your_base64_token_here>
POCKETBASE_URL=https://your-instance.pockethost.io
```

Secrets are injected as environment variables into the PocketBase process and are available via `$os.getenv()` in all `pb_hooks`. They are never stored in your codebase or Docker image.

### 🔵 Easypanel

Go to your App Service → **Environment** tab → add:

```
CLIP_API_KEY=<your_base64_token_here>
POCKETBASE_URL=https://pb.myapp.com
```

Variables are injected at runtime by Docker Swarm — they do not get baked into the image. Changes require a service restart, not a rebuild.

### 🐳 Docker Compose

```yaml
services:
  pocketbase:
    image: your-pb-image
    environment:
      CLIP_API_KEY: <your_base64_token_here>
      POCKETBASE_URL: https://pb.myapp.com
    volumes:
      - ./pb_data:/pb_data
```

### 🖥️ Local development

```bash
CLIP_API_KEY=<your_base64_token_here> POCKETBASE_URL=http://localhost:8090 ./pocketbase serve
```

---

## 🔌 Connecting your business logic

After a payment status changes, PocketBase fires `onRecordAfterUpdateSuccess` on the `clip_orders` collection. Edit `pb_hooks/my_app_clip_handler.pb.js` in **your own project** to react:

```js
/// <reference path="../pb_data/types.d.ts" />

onRecordAfterUpdateSuccess((e) => {
    const status = e.record.getString("status");

    if (status === "COMPLETED") {
        const refCollection = e.record.getString("reference_collection"); // e.g. "products"
        const refId         = e.record.getString("reference_id");         // e.g. "abc123"
        const userId        = e.record.getString("user");                 // empty for guest checkouts
        const receiptNo     = e.record.getString("receipt_no");
        const amountPaid    = e.record.get("amount_paid");

        // 👉 Your logic here:
        //   - activate a product or subscription
        //   - send a confirmation email
        //   - unlock a trip, course, or order
        //   - update inventory

        $app.logger().info("Payment completed",
            "ref_collection", refCollection,
            "ref_id", refId,
            "receipt", receiptNo
        );
    }

    e.next();
}, "clip_orders");
```

> 💡 The bootstrap hook prints a reminder to the console on every PocketBase restart so you never forget the file path to edit.

---

## 💳 Creating a payment link

Call `POST /api/clip/create-link` from your frontend or backend. The user must be authenticated **or** you can create guest orders without a token.

**Authenticated request:**
```http
POST /api/clip/create-link
Authorization: Bearer <user-token>
Content-Type: application/json

{
  "amount": 299.00,
  "reference_collection": "products",
  "reference_id": "PROD_ABC123"
}
```

**Guest request** (no `Authorization` header needed):
```http
POST /api/clip/create-link
Content-Type: application/json

{
  "amount": 299.00,
  "reference_collection": "products",
  "reference_id": "PROD_ABC123"
}
```

**Response:**
```json
{
  "order_id": "pb_record_id",
  "payment_url": "https://checkout.clip.mx/pay/abc123",
  "payment_request_id": "clip-uuid",
  "status": "CREATED"
}
```

Redirect your user to `payment_url`. Clip handles the payment page.

---

## 🔄 Payment flow

```
Your App                   PocketBase                      Clip API
   │                            │                               │
   │  POST /api/clip/           │                               │
   │    create-link ───────────►│                               │
   │                            │── POST /v1/checkout ─────────►│
   │                            │◄── { payment_url, id } ───────│
   │◄── { payment_url } ────────│                               │
   │                            │                               │
   │  redirect user to ►────────┼───────────────────────────────► Clip checkout page
   │  payment_url               │                               │
   │                            │                               │
   │                            │◄── POST /api/clip/webhook ────│  (user pays)
   │                            │── GET /v1/checkout/{id} ─────►│  (re-query real state)
   │                            │◄── { resource_status } ────────│
   │                            │                               │
   │                            │  updates clip_orders.status   │
   │                            │  fires onRecordAfterUpdate    │
   │                            │  → my_app_clip_handler.pb.js  │
```

> 🔐 **Security note:** The Clip webhook payload only contains an ID, not the payment status. The plugin always re-queries `GET /v1/checkout/{id}` on the Clip API before trusting any state change — the API response is always the source of truth.

---

## 🗂️ Collections reference

### `clip_orders`

The central entity. One record per payment attempt.

| Field | Type | Description |
|---|---|---|
| `reference_collection` | `text` | Name of your host collection (e.g. `products`, `trips`, `courses`) |
| `reference_id` | `text` | ID of the record being paid for in that collection |
| `user` | `relation` | PocketBase user — **empty for guest checkouts** |
| `amount` | `number` | Amount requested in MXN |
| `currency` | `text` | Always `MXN` |
| `status` | `select` | See [Order status lifecycle](#-order-status-lifecycle) below |
| `clip_payment_request_id` | `text` | Clip's unique payment ID (unique index) |
| `clip_payment_url` | `url` | Redirect URL for the user to complete payment |
| `clip_raw_status` | `text` | Raw `resource_status` string from the Clip API (audit) |
| `receipt_no` | `text` | Clip receipt number — set on `COMPLETED` |
| `amount_paid` | `number` | Actual amount confirmed by Clip — set on `COMPLETED` |
| `paid_at` | `date` | Timestamp of successful payment |
| `canceled_at` | `date` | Timestamp of cancellation or expiry |
| `created` | `autodate` | Set once on record creation |
| `updated` | `autodate` | Updated on every record save |

### `clip_payments`

Immutable audit log. One record per webhook event received.

| Field | Type | Description |
|---|---|---|
| `order` | `relation` | The `clip_orders` record this event belongs to |
| `raw_webhook_payload` | `json` | The exact payload received from Clip |
| `raw_api_response` | `json` | The full response from `GET /v1/checkout/{id}` |
| `received_at` | `date` | When the webhook arrived |
| `created` | `autodate` | Set once on record creation |
| `updated` | `autodate` | Updated on every record save |

> 📌 **Migration note:** PocketBase does **not** auto-add `created`/`updated` fields when collections are created via migrations (only the Admin UI does that). Both fields are declared explicitly as `autodate` in the migration file.

---

## 📊 Order status lifecycle

```
PENDING_LINK  →  CREATED  →  PENDING  →  COMPLETED
                                      ↘  CANCELED
                                      ↘  EXPIRED
ERROR_CLIP  (Clip API unreachable at link creation time)
```

| Status | Meaning |
|---|---|
| `PENDING_LINK` | Order record created locally, Clip API call not yet made |
| `CREATED` | Clip payment link created successfully, waiting for user |
| `PENDING` | User has started the payment process on Clip |
| `COMPLETED` | ✅ Payment confirmed — trigger your business logic |
| `CANCELED` | ❌ User canceled or payment was declined |
| `EXPIRED` | ⏱️ Payment link expired before the user completed payment |
| `ERROR_CLIP` | ⚠️ Clip API returned an error during link creation |

---

## 📁 Plugin file reference

| File | Purpose | Edit? |
|---|---|---|
| `clip_00_bootstrap.pb.js` | Startup console messages and status | ❌ No |
| `clip_api_client.pb.js` | Centralized Clip API HTTP client | ❌ No |
| `clip_create_link.pb.js` | `POST /api/clip/create-link` route | ❌ No |
| `clip_webhook.pb.js` | `POST /api/clip/webhook` route | ❌ No |
| `my_app_clip_handler.pb.js` | Your business logic after payment | ✅ **Yes — this is yours** |
| `pb_migrations/1721500000_clip_collections.js` | Creates `clip_orders` and `clip_payments` | ❌ No |

---

## ⚠️ Important notes

- 🚫 **Clip has no sandbox** — all API calls hit production. To test, use real MXN $1.00 charges and refund immediately from the Clip dashboard.
- 🔒 **Webhook security** — Clip does not expose a verifiable HMAC signature on webhook payloads. The plugin mitigates this by always re-querying the Clip API to confirm the payment state before updating any record.
- 🔁 **Webhook retries** — if the Clip API is unreachable when the webhook arrives, the plugin responds with HTTP 502 so Clip automatically retries delivery.
- 🌐 **`POCKETBASE_URL`** must be publicly reachable by Clip's servers. `localhost` will not work for webhook delivery in production.

---

## 📄 License

MIT — use it freely in your own projects.
