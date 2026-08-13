# Comprehensive Guide: PocketBase JSVM Hooks, Migrations, and Live Configuration

This document provides a detailed technical breakdown of how **PocketBase v0.23+**, JavaScript hooks (`pb_hooks`), database migrations (`pb_migrations`), and **live/hot configuration settings** operate within this payment plugin architecture.

---

## Table of Contents

1. [Architecture & Execution Lifecycle](#1-architecture--execution-lifecycle)
2. [PocketBase JavaScript Hooks (`pb_hooks`)](#2-pocketbase-javascript-hooks-pb_hooks)
   - [File Discovery & Execution Order](#file-discovery--execution-order)
   - [Custom Router Endpoints (`routerAdd`)](#custom-router-endpoints-routeradd)
   - [Event Hooks & Lifecycle Events](#event-hooks--lifecycle-events)
   - [Scope Isolation & Module Imports (`require`)](#scope-isolation--module-imports-require)
   - [PocketBase v0.23+ Record API](#pocketbase-v023-record-api)
   - [Extension Points for Business Logic](#extension-points-for-business-logic)
3. [PocketBase Database Migrations (`pb_migrations`)](#3-pocketbase-database-migrations-pb_migrations)
   - [Purpose & Automatic Execution](#purpose--automatic-execution)
   - [Migration Naming Convention](#migration-naming-convention)
   - [Structure of a Migration File](#structure-of-a-migration-file)
   - [Defining Collections, Schemas, & API Rules](#defining-collections-schemas--api-rules)
   - [Data Seeding](#data-seeding)
4. [Hot / Live Environment & Configuration System](#4-hot--live-environment--configuration-system)
   - [The Precedence Hierarchy (Env Vars vs DB)](#the-precedence-hierarchy-env-vars-vs-db)
   - [The `getEnvOrSetting` Helper](#the-getenvorsetting-helper)
   - [The Setup Wizard (`/setup`)](#the-setup-wizard-setup)
   - [Zero-Downtime Hot Updates](#zero-downtime-hot-updates)
5. [Operational Best Practices](#5-operational-best-practices)

---

## 1. Architecture & Execution Lifecycle

PocketBase uses an embedded JavaScript engine (**Goja**) to execute ECMAScript 5.1+ code directly inside the Go server binary.

When PocketBase boots up, the execution order follows a strict 3-stage lifecycle:

```text
       ┌──────────────────────────────────────────────┐
       │   1. DATABASE MIGRATIONS (pb_migrations/*.js) │
       └──────────────────────┬───────────────────────┘
                              │ (Creates tables, indexes, seeds records)
                              ▼
       ┌──────────────────────────────────────────────┐
       │   2. HOOK DISCOVERY & INITIALIZATION         │
       │      (pb_hooks/*.pb.js loaded in order)      │
       └──────────────────────┬───────────────────────┘
                              │ (Registers routes, cron jobs, event handlers)
                              ▼
       ┌──────────────────────────────────────────────┐
       │   3. STARTUP VALIDATION & RUNTIME            │
       │      (onBootstrap event triggers)            │
       └──────────────────────────────────────────────┘
```

---

## 2. PocketBase JavaScript Hooks (`pb_hooks`)

### File Discovery & Execution Order

PocketBase automatically executes all files matching the pattern `pb_hooks/*.pb.js` during server startup.

- **Filenames ending in `.pb.js`** are executed automatically at boot.
- **Filenames ending in `.js`** (without `.pb`) are treated as helper modules and are **NOT** executed automatically. They must be explicitly imported using `require()`.

Files are evaluated in alphabetical order. To enforce execution order, prefix hook filenames with numerical ordering:
- `clip_00_bootstrap.pb.js` (runs first, triggers configuration validator)
- `spei_00_bootstrap.pb.js`
- `clip_create_link.pb.js`
- `setup_wizard.pb.js`

### Custom Router Endpoints (`routerAdd`)

Custom HTTP API routes are registered using `routerAdd(method, path, handler)`:

```javascript
routerAdd("POST", "/api/clip/create-link", (e) => {
  // Extract request body and headers
  var info = e.requestInfo();
  var body = info.body || {};
  
  // Return JSON response
  return e.json(200, { success: true, checkout_url: "https://..." });
});
```

#### Key Helper Methods on Request Event (`e`):

| Method | Purpose |
|---|---|
| `e.requestInfo()` | Returns structured request info (`body`, `headers`, `query`, `auth`) |
| `e.hasSuperuserAuth()` | Returns `true` if caller is an authenticated superuser |
| `e.json(status, data)` | Responds with JSON content-type |
| `e.html(status, htmlString)` | Responds with HTML content-type |
| `e.fileFS(fs, path)` | Serves static file safely using Go filesystem bridge (`$os.dirFS`) |
| `e.redirect(status, url)` | Performs HTTP redirect (e.g. `302`) |

### Event Hooks & Lifecycle Events

PocketBase provides hooks to intercept lifecycle events:

```javascript
// Server bootstrap event
onBootstrap((e) => {
  if (typeof e.next === "function") e.next(); // Continue event chain
  
  // Custom initialization logic
  console.log("PocketBase booted successfully.");
});

// Record interceptor hooks
onRecordBeforeCreateRequest((e) => {
  if (typeof e.next === "function") e.next();
  // Modify record before saving
  e.record.set("status", "PENDING");
}, "clip_orders");

// Automated Cron jobs
onCron("spei_cep_retry", "*/5 * * * *", (e) => {
  // Executed every 5 minutes
});
```

### Scope Isolation & Module Imports (`require`)

Goja does not support global Node.js CommonJS modules directly. PocketBase provides a special global variable `${__hooks}` representing the absolute path to the `pb_hooks` directory.

To share code cleanly across hooks without polluting the global scope, write helper utilities in CommonJS `.js` files and import them **inside handler functions**:

```javascript
// In pb_hooks/plugin_settings_helper.js:
module.exports = {
  getSetting: function(key, defaultValue) { ... }
};

// In pb_hooks/clip_create_link.pb.js:
routerAdd("POST", "/api/clip/create-link", (e) => {
  // ALWAYS require inside handler to ensure clean scope
  var psh = require(`${__hooks}/plugin_settings_helper.js`);
  var amountField = psh.getSetting("clip_amount_field", "total");
  ...
});
```

### PocketBase v0.23+ Record API

PocketBase v0.23+ deprecated the legacy `dao()` interface in favor of unified `$app` database operations:

```javascript
// Find record by ID
var order = $app.findRecordById("clip_orders", orderId);

// Find first matching record
var setting = $app.findFirstRecordByFilter(
  "plugin_settings",
  "key = {:key}",
  { key: "clip_webhook_secret" } // Always use parameterized placeholders!
);

// Find multiple records
var pending = $app.findRecordsByFilter(
  "spei_orders",
  "status = 'PENDING' AND created >= {:cutoff}",
  { cutoff: "2026-01-01 00:00:00.000Z" }
);

// Create new record
var collection = $app.findCollectionByNameOrId("clip_orders");
var newOrder = new Record(collection);
newOrder.set("reference_id", "ORD-1001");
newOrder.set("amount", 250.00);
$app.save(newOrder);

// Validate superuser/user password
if (adminRecord.validatePassword(providedPassword)) {
  // Password matches
}
```

### Extension Points for Business Logic

To allow developers to customize post-payment business logic (e.g. updating order status in custom tables, sending confirmation emails) without modifying core plugin hooks, the architecture exposes decoupled handler files:

- `pb_hooks/my_app_clip_handler.pb.js` — Executed when a Clip payment is completed or refunded.
- `pb_hooks/my_app_spei_handler.pb.js` — Executed when a SPEI payment is verified via Banxico CEP.

---

## 3. PocketBase Database Migrations (`pb_migrations`)

### Purpose & Automatic Execution

Database migrations define the schema of PocketBase collections, field types, indexes, and initial configuration records programmatically.

When PocketBase boots up, it compares files in `pb_migrations/` against the `_migrations` internal database table. Any unapplied migration files are executed sequentially inside a database transaction before the HTTP server starts.

### Migration Naming Convention

Migration filenames must begin with a Unix timestamp or sequential numerical prefix:
- `1721500000_clip_collections.js`
- `1721500003_spei_collections.js`
- `1785790000_plugin_settings.js`
- `1786000002_setup_wizard_settings.js`

### Structure of a Migration File

Every migration exports a call to `migrate(up, down)`:

```javascript
/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // UP migration: applied when server starts
  try {
    app.findCollectionByNameOrId("my_custom_collection");
    return; // Idempotent check: skip if already exists
  } catch (_) {}

  const col = new Collection({
    id: "coll_custom0001",
    name: "my_custom_collection",
    type: "base",
    listRule: null,   // Lock REST API access
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      { name: "title",   type: "text", required: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_custom_title` ON `my_custom_collection` (`title`)"
    ]
  });

  app.save(col);
}, (app) => {
  // DOWN migration: applied during rollback
  try {
    const col = app.findCollectionByNameOrId("my_custom_collection");
    app.delete(col);
  } catch (_) {}
});
```

### Defining Collections, Schemas, & API Rules

Setting API rules (`listRule`, `viewRule`, `createRule`, `updateRule`, `deleteRule`) to `null` restricts CRUD operations strictly to server-side code (hooks) or authenticated superusers in the Admin UI. Clients cannot directly tamper with payment tables over the REST API.

### Data Seeding

Migrations can also seed essential default records:

```javascript
migrate((app) => {
  const col = app.findCollectionByNameOrId("plugin_settings");
  
  const defaultSetting = new Record(col);
  defaultSetting.set("key", "is_configured");
  defaultSetting.set("value", "false");
  defaultSetting.set("description", "Indicates if the setup wizard has run");
  app.save(defaultSetting);
}, (app) => { ... });
```

---

## 4. Hot / Live Environment & Configuration System

### The Precedence Hierarchy (Env Vars vs DB)

To support both containerized cloud deployments (Coolify, Docker, Kubernetes) and zero-downtime GUI administration, the plugin implements a **2-tier configuration hierarchy**:

```text
                   ┌──────────────────────────────────────────────┐
                   |   TIER 1: Environment Variables              |
                   |   (CLIP_API_KEY, POCKETBASE_URL)              |
                   └──────────────────────┬───────────────────────┘
                                          │ (If present, overrides DB)
                                          ▼
                   ┌──────────────────────────────────────────────┐
                   │   TIER 2: Database Settings                  │
                   │   (plugin_settings collection in SQLite)     │
                   └──────────────────────────────────────────────┘
```

### The `getEnvOrSetting` Helper

The module `pb_hooks/plugin_settings_helper.js` provides `getEnvOrSetting(envKey, settingKey, defaultValue)`:

1. Checks `$os.getenv(envKey)`. If defined and non-empty, returns the environment variable immediately.
2. If environment variable is absent or empty, queries the `plugin_settings` database collection for `settingKey`.
3. If not found in database either, returns `defaultValue`.

```javascript
var psh = require(`${__hooks}/plugin_settings_helper.js`);

// Returns env var CLIP_API_KEY if set in Docker; otherwise returns clip_api_key from DB
var apiKey = psh.getEnvOrSetting("CLIP_API_KEY", "clip_api_key", "");
```

### The Setup Wizard (`/setup`)

When PocketBase is deployed without environment variables, the **Setup Wizard** allows administrators to initialize credentials via a web interface at `https://your-domain.com/setup`:

#### Endpoints:
- `GET /setup` — Serves the interactive setup interface (`pb_public/setup.html` or embedded HTML string).
- `GET /api/plugin/setup-status` — Public endpoint returning `{ is_configured: boolean, pocketbase_url_suggestion: string }`.
- `POST /api/plugin/setup` — Protected setup endpoint. Validates superuser credentials (`identity` & `password`) via `adminRecord.validatePassword(password)` and saves settings to `plugin_settings`.

### Zero-Downtime Hot Updates

Because credentials (`clip_api_key`, `pocketbase_url`, `clip_webhook_secret`, `admin_user_ids`) can be stored inside the SQLite database (`plugin_settings`), administrators can update API keys or webhook secrets **in real time**:

1. Navigate to `/setup` or the PocketBase Admin UI (`/_/`).
2. Update the `clip_api_key` or `clip_webhook_secret` value.
3. Save the record.
4. Subsequent API requests immediately read the new value from SQLite — **zero container restarts required**.

If `clip_webhook_secret` is missing at boot in a production environment, the validator (`plugin_config_validator.js`) automatically generates a secure 32-character random string using `$security.randomString(32)` and saves it to the database, ensuring PocketBase never crashes due to uninitialized secrets.

---

## 5. Operational Best Practices

1. **Persistent Storage in Docker:**
   - Always mount `/pb/pb_data` to a persistent volume (e.g. `pb-data:/pb/pb_data`).
   - Do **NOT** mount `/pb/pb_hooks` or `/pb/pb_migrations` to a persistent volume, as doing so would prevent new code updates pushed to GitHub from taking effect on redeploy.

2. **Webhook Security:**
   - Always append `?token=<clip_webhook_secret>` to your webhook URL registered in the Clip Developer Dashboard.
   - Example: `https://your-domain.com/api/clip/webhook?token=your_random_uuid_here`

3. **Database Security:**
   - Keep `plugin_settings` API rules set to `null` so external API users cannot inspect or modify tokens over the public REST API.
