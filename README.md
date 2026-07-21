# pocketbase-clip-mx

A drop-in plugin for any PocketBase project that adds payment link support via the Clip México Checkout API.

## What this plugin does

- Exposes `POST /api/clip/create-link` — creates a Clip payment link and stores a `clip_orders` record.
- Exposes `POST /api/clip/webhook` — receives the Clip webhook signal, re-queries the Clip API for the real payment state, and updates the `clip_orders` record.
- Creates two collections automatically on first boot: `clip_orders` and `clip_payments` (audit log).
- Prints the exact file path to edit for your own business logic every time PocketBase starts.

This plugin is intentionally blind to your business domain. It does not activate products, send emails, or know what a "product" is. You wire that logic yourself in a separate file (see [Connecting your business logic](#connecting-your-business-logic)).

## Installation

This is a **file-only plugin** — no Dockerfile, no separate service. Copy the files into your existing PocketBase project and restart.

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

**Steps:**

1. Copy the five files from `pb_hooks/` into your project's `pb_hooks/` directory.
2. Copy the file from `pb_migrations/` into your project's `pb_migrations/` directory.
3. Add the two required environment variables to your deployment (see below).
4. Restart PocketBase — migrations run automatically and the routes become available.

## Environment variables

Add these two variables wherever your PocketBase process reads its environment: your shell, `docker run -e`, Docker Compose `environment:`, Easypanel App Service → Environment, etc.

| Variable | Required | Description |
|---|---|---|
| `CLIP_API_KEY` | Yes | Your Clip Checkout API key. Found in the Clip developer dashboard. |
| `POCKETBASE_URL` | Yes | The public URL of your PocketBase instance, **no trailing slash**. Used to register the webhook callback with Clip. Example: `https://pb.myapp.com` |

**Never hardcode these values in the plugin files or your Dockerfile.** They are credentials — keep them in your deployment environment only.

### Easypanel

In your App Service go to **Environment** and add:

```
CLIP_API_KEY=your_clip_api_key_here
POCKETBASE_URL=https://pb.myapp.com
```

PocketBase reads them at runtime via `$os.getenv()`. No rebuild required when you change them — only a service restart.

### Docker Compose

```yaml
services:
  pocketbase:
    image: your-pb-image
    environment:
      CLIP_API_KEY: your_clip_api_key_here
      POCKETBASE_URL: https://pb.myapp.com
```

## Connecting your business logic

The plugin fires `onRecordAfterUpdateSuccess` events on `clip_orders` whenever a payment status changes. Edit `pb_hooks/my_app_clip_handler.pb.js` in **your own project** to react:

```js
onRecordAfterUpdateSuccess((e) => {
    if (e.record.getString("status") === "COMPLETED") {
        const refCollection = e.record.getString("reference_collection");
        const refId         = e.record.getString("reference_id");
        const userId        = e.record.getString("user"); // empty string for guest checkouts

        // Your logic here: activate a product, unlock a seat, send an email, etc.
    }
    e.next();
}, "clip_orders");
```

Every time PocketBase starts, the bootstrap hook logs this reminder to the console:

```
[CLIP PLUGIN] To add your business logic after payment, create/edit:
[CLIP PLUGIN]   -> pb_hooks/my_app_clip_handler.pb.js
```

## Payment flow

```
Your frontend                PocketBase                    Clip API
     │                           │                              │
     │  POST /api/clip/          │                              │
     │    create-link ──────────►│                              │
     │                           │  POST /v1/checkout ─────────►│
     │                           │◄── { payment_url, id } ──────│
     │◄── { payment_url } ───────│                              │
     │                           │                              │
     │  (user pays on Clip page) │                              │
     │                           │                              │
     │                           │◄── POST /api/clip/webhook ───│
     │                           │  GET /v1/checkout/{id} ─────►│
     │                           │◄── { resource_status } ──────│
     │                           │  update clip_orders          │
     │                           │  fire onRecordAfterUpdate    │
     │                           │  → your handler runs         │
```

## clip_orders fields

| Field | Type | Description |
|---|---|---|
| `reference_collection` | text | Name of your host collection (e.g. `products`, `trips`) |
| `reference_id` | text | ID of the record being paid for |
| `user` | relation | PocketBase user — empty for guest checkouts |
| `amount` | number | Amount charged in MXN |
| `status` | select | `PENDING_LINK` → `CREATED` → `PENDING` → `COMPLETED` / `CANCELED` / `EXPIRED` |
| `clip_payment_request_id` | text | Clip's payment ID (unique index) |
| `clip_payment_url` | url | The URL to redirect the user to for payment |
| `clip_raw_status` | text | Raw status string from the Clip API (for auditing) |
| `receipt_no` | text | Clip receipt number (set on COMPLETED) |
| `amount_paid` | number | Actual amount confirmed by Clip (set on COMPLETED) |
| `paid_at` | date | Timestamp of successful payment |
| `canceled_at` | date | Timestamp of cancellation or expiry |
| `created` | autodate | Set once on record creation |
| `updated` | autodate | Updated on every record save |

## Notes

- Clip has **no sandbox environment** — all API calls are against production. Test with real MXN 1.00 charges and refund immediately.
- The webhook payload from Clip only contains an ID. The plugin always re-queries `GET /v1/checkout/{id}` before trusting any status change.
- If the Clip API is unreachable when the webhook arrives, the plugin returns HTTP 502 so Clip retries delivery automatically.
- Requires PocketBase v0.23 or later (uses `Buffer.from()` for Base64 encoding, confirmed available since at least v0.23).
