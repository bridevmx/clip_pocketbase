# HANDOFF — PocketBase Clip México + SPEI/CEP Plugin

> **Session date**: 2026-07-22
> **Repository**: https://github.com/bridevmx/clip_pocketbase
> **Current state**: Clip plugin PRODUCTION-READY (36/36 tests passing). SPEI plugin IMPLEMENTED + CODE REVIEWED, pending deploy.

---

## 1. What We Built

### Clip Plugin (Payment Links + Webhooks)
A portable PocketBase plugin for integrating Clip México's Checkout API v2. File-only, no Docker, no npm dependencies. Copy files → set env vars → done.

### SPEI/CEP Plugin (Bank Transfers)
Complementary plugin for verifying SPEI bank transfers via Banxico's CEP system. Automatic validation, retry mechanism, manual escalation.

---

## 2. Architecture Decisions (ADRs)

| ADR | Decision | Status |
|-----|----------|--------|
| 0001 | Installation via file copy + auto-migrations | ✅ Done |
| 0002 | Generic reference via `reference_collection` + `reference_id` text fields (no typed FK) | ✅ Done |
| 0003 | Business logic extension via `onRecordAfterUpdateSuccess` in handler files | ✅ Done |
| 0004 | Fase 1: Refund + Transactions + Status Check endpoints | ✅ Done |
| — | SPEI/CEP: Separate from Clip, auto-validate CEP, retry 5min × 12, then MANUAL_REVIEW | ✅ Done |

---

## 3. Project Structure

```
clip_pocketbase/
├── Dockerfile                                    # Easypanel deployment
├── .github/workflows/docker.yml                  # CI/CD (blocked by billing)
├── README.md                                     # Full documentation (EN)
├── docs/
│   ├── CONTEXT.md                                # Domain glossary
│   ├── adr/0001-installation-via-migrations.md
│   ├── adr/0002-generic-reference-by-text.md
│   ├── adr/0003-extension-via-native-hook.md
│   ├── adr/0004-fase1-refund-transactions.md
│   ├── PLAN-spei-cep-plugin.md                   # SPEI design document
│   ├── DEPLOY-spei.md                            # SPEI deploy guide
│   └── future-apis.md                            # Deposits + Pinpad (roadmap)
├── pb_hooks/
│   ├── clip_00_bootstrap.pb.js                   # Console messages
│   ├── clip_api_client.js                        # CommonJS: HTTP client
│   ├── clip_create_link.pb.js                    # POST /api/clip/create-link
│   ├── clip_webhook.pb.js                        # POST /api/clip/webhook
│   ├── clip_refund.pb.js                         # POST /api/clip/refund
│   ├── clip_transactions.pb.js                   # GET /api/clip/transaction/{receipt}
│   ├── clip_status_check.pb.js                   # GET /api/clip/order/{id}/status
│   ├── my_app_clip_handler.pb.js                 # Business logic (user editable)
│   ├── spei_00_bootstrap.pb.js                   # SPEI bootstrap
│   ├── spei_api_client.js                        # CommonJS: CEP validation
│   ├── spei_create_order.pb.js                   # POST /api/spei/create-order
│   ├── spei_report_payment.pb.js                 # POST /api/spei/report-payment
│   ├── spei_validate_cep.pb.js                   # POST /api/spei/validate-cep (staff)
│   ├── spei_status_check.pb.js                   # GET /api/spei/order/{id}/status
│   ├── spei_cep_form.pb.js                       # GET /api/spei/form
│   └── my_app_spei_handler.pb.js                 # SPEI business logic
├── pb_migrations/
│   ├── 1721500000_clip_collections.js            # clip_orders, clip_payments
│   ├── 1721500001_fix_clip_orders_partial_index.js
│   ├── 1721500002_add_refund_fields.js
│   ├── 1721500003_spei_collections.js            # spei_settings, spei_orders, etc.
│   └── 1721500004_spei_banks_data.js             # ~100 Mexican banks
├── pb_public/
│   └── spei-cep-form.html                        # SPEI payment form
└── scripts/
    └── test.js                                   # E2E tests (36/36)
```

---

## 4. Key Technical Decisions

### Clip Plugin

| Decision | Rationale |
|----------|-----------|
| `CLIP_API_KEY` stores pre-encoded Base64 | Plugin detects `"Basic "` prefix, uses as-is |
| CommonJS `require()`/`module.exports` | Only way to share functions in Goja runtime |
| `clip_api_client.js` as non-`.pb.` file | Prevents auto-execution as hooks |
| `{ data, statusCode }` return pattern | Callers handle each HTTP status explicitly |
| Idempotent webhook | Returns `200 already_processed` if order already terminal |
| Partial unique index | `WHERE clip_payment_request_id != ''` |
| PocketBase migration API | Use `collection.fields.add(new Field({...}))` NOT `app.addField()` |
| Refund `reference.type` | Must be `"receipt"` not `"ORDER_ID"` (Clip API oneof constraint) |
| Refund auth | `info.auth.isSuperUser` doesn't exist → lookup in `_superusers` collection |

### SPEI Plugin

| Decision | Rationale |
|----------|-----------|
| SPEI and Clip completely separate | Independent collections, different status flows |
| Auto-validate CEP on payment report | No manual step required |
| Retry every 5 min, max 12 retries | ~1 hour window before escalation |
| Multiple beneficiary accounts | `spei_settings` supports multiple with `is_active` flag |
| Banks from DB | `spei_banks` collection, not hardcoded |
| Form via iframe | Served from `pb_public/spei-cep-form.html` |
| Auth on validate-cep | Staff only, no public access |
| Shared `evaluateCepResult()` | Eliminates duplication between hooks |

---

## 5. API Endpoints

### Clip Plugin

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/clip/create-link` | Optional | Create payment link |
| POST | `/api/clip/webhook` | None | Receive Clip webhook |
| POST | `/api/clip/refund` | Superuser | Refund payment |
| GET | `/api/clip/transaction/{receipt}` | User | Get transaction by receipt |
| GET | `/api/clip/transactions` | User | List transactions (date range) |
| GET | `/api/clip/order/{id}/status` | User | Check order status |

### SPEI Plugin

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/spei/create-order` | Optional | Create SPEI order |
| POST | `/api/spei/report-payment` | None | Report payment + auto-validate CEP |
| POST | `/api/spei/validate-cep` | Staff | Manual CEP validation retry |
| GET | `/api/spei/order/{id}/status` | User | Check order status |
| GET | `/api/spei/form` | None | HTML form (iframe) |

---

## 6. Collections

### Clip

- **`clip_orders`**: Payment orders with status lifecycle
- **`clip_payments`**: Immutable audit trail of webhook events

### SPEI

- **`spei_settings`**: Beneficiary bank accounts (CLABE, bank, holder)
- **`spei_orders`**: SPEI payment orders with retry tracking
- **`cep_verifications`**: CEP validation audit trail
- **`spei_banks`**: ~100 Mexican bank catalog

---

## 7. Status Flows

### Clip Orders
```
PENDING_LINK → CREATED → PENDING → COMPLETED
                                ↘ CANCELED
                                ↘ EXPIRED
ERROR_CLIP (on creation failure)
```

### SPEI Orders
```
PENDING → REPORTED → LIQUIDADO (CEP match)
                 ↓
                 → REJECTED (CEP mismatch)
                 ↓
                 → PENDING (retry, "en proceso")
                    ↓
                    → MANUAL_REVIEW (after 12 retries)
                       ↓
                       → EXPIRED (after 24h)
```

---

## 8. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLIP_API_KEY` | Yes | Clip API token (pre-encoded Base64 with `Basic ` prefix) |
| `POCKETBASE_URL` | Yes | Public URL of PocketBase instance |
| `BANXICO_TOKEN` | SPEI only | Banxico API token for CEP validation |

---

## 9. Testing

### E2E Tests (`scripts/test.js`)
- **36/36 tests passing** on Easypanel
- Tests: create-link, webhook, refund, transactions, status check
- Run against live Easypanel instance

### Easypanel Instance
- **URL**: `https://apps-clip-ify-pocketbase.0itkyu.easypanel.host`
- **Test credentials**: `test@tes.com / 123123123`
- **$1 real payment test**: Completed successfully (receipt `P8rQk5rs`)
- **$1 real refund test**: Completed successfully (receipt `P8rQk5rs` refunded)

---

## 10. Git History (Recent)

```
6bb1633 docs: add SPEI/CEP plugin documentation
9a9cfb8 chore: add GitHub Actions workflow for Docker build
d448969 chore: add Dockerfile for Easypanel deployment
2d21c08 fix: code review improvements for SPEI plugin
9e15d15 feat: add SPEI/CEP plugin for bank transfer verification
4966c94 fix: use valid reference type 'receipt' for Clip refund API
15f28cc fix: add required reference object to Clip refund payload
a159ab5 fix: use _superusers collection lookup instead of info.auth.isSuperUser
84e969b fix: align test assertions with PocketBase actual behavior
79663e0 fix: correct migration to use proper PocketBase API for adding fields
6e058c4 Merge pull request #7 from bridevmx/docs/fase1
25231f8 docs: update README with refund, transactions, and status check endpoints
dc51f69 Merge pull request #6 from bridevmx/feat/fase1-handler-tests
808588d feat: add refund event examples to handler, add E2E tests for new endpoints
2a9c07b Merge pull request #5 from bridevmx/feat/fase1-endpoints
7f85c0c feat: add refund, transactions, and status check endpoints
9f65a3f Merge pull request #4 from bridevmx/feat/fase1-base
f39d803 feat: add refund and transaction functions to api_client, add refund fields migration
7e59959 docs: rewrite README in Spanish, professional tone with emojis
4d58cbe feat: add custom fields support to create-link, improve handler examples
```

---

## 11. What's Done

### Clip Plugin (PRODUCTION-READY)
- ✅ Payment links via Checkout API v2
- ✅ Webhook with idempotent handling
- ✅ Refund with superuser auth
- ✅ Transaction queries (by receipt, by date range)
- ✅ Status check endpoint
- ✅ 36/36 E2E tests passing
- ✅ Real $1 payment + refund verified on Easypanel
- ✅ Full README documentation

### SPEI Plugin (DEPLOYED)
- ✅ 4 collections created via migrations
- ✅ ~100 banks seeded
- ✅ CommonJS API client with shared functions
- ✅ Create order endpoint
- ✅ Report payment endpoint with auto CEP validation
- ✅ Validate CEP endpoint (staff only)
- ✅ Status check endpoint
- ✅ HTML form (iframe)
- ✅ Code review completed (auth check, shared logic, English names)
- ✅ Dockerfile + GitHub Actions workflow
- ✅ README + DEPLOY guide
- ✅ Deployed on Easypanel — server running at `http://0.0.0.0:80`

---

## 12. What's Left

### Immediate (SPEI Deploy)
| Task | Priority | Status |
|------|----------|--------|
| Deploy SPEI to Easypanel | HIGH | ✅ DONE — Running at `http://0.0.0.0:80` |
| Test SPEI endpoints on live instance | HIGH | PENDING |
| Verify CEP validation works with real data | HIGH | PENDING |

### Medium Term
| Task | Priority | Notes |
|------|----------|-------|
| EXPIRED transition (24h TTL) | MEDIUM | No cron/scheduler implemented |
| SPEI E2E tests (`scripts/test-spei.js`) | MEDIUM | Similar to Clip tests |
| Update README with SPEI sections | LOW | Already partially done |

### Future (Roadmap)
| Feature | Notes |
|---------|-------|
| Deposits (OXXO, SPEI direct) | Documented in `future-apis.md` |
| Pinpad (terminal POS) | Documented in `future-apis.md` |
| HMAC webhook verification | Clip doesn't expose HMAC yet |

---

## 13. Known Issues

| Issue | Severity | Workaround |
|-------|----------|------------|
| GitHub Actions billing locked | LOW | Manual docker build on server |
| Banxico CEP is HTML scraping | MEDIUM | Fragile, may break if HTML changes |
| CEP validation is synchronous | LOW | Blocks on 30s Banxico timeout |
| No EXPIRED cron job | LOW | Orders stay MANUAL_REVIEW forever |
| `validate-cep` was public | FIXED | Now requires staff auth |

---

## 14. User Preferences

- **Language**: Chat replies in Spanish (LATAM), all file artifacts in English
- **Git push**: `git config credential.helper '!gh auth git-credential'`
- **Workflow**: `/handoff` → `/to-spec` → `/to-tickets` → PRs
- **Testing**: E2E tests against live Easypanel instance
- **Deploy**: Easypanel with Docker from GitHub Container Registry

---

## 15. Next Agent Instructions

1. **Deploy SPEI to Easypanel**: Build Docker image manually (GitHub Actions blocked), push to GHCR, update Easypanel service
2. **Test SPEI endpoints**: Create order, report payment, verify CEP validation
3. **Fix EXPIRED transition**: Implement TTL logic or document as future enhancement
4. **Add SPEI E2E tests**: Similar structure to Clip tests in `scripts/test.js`

---

## 16. Critical Context

- **PocketBase `info.auth.isSuperUser` does NOT exist** — must lookup in `_superusers` collection
- **Clip API refunds require `reference` object** with `type: "receipt"` and `id: receiptNo`
- **Banxico CEP is HTML scraping**, not a proper API — fragile
- **CEP validation blocks synchronously** on 30s Banxico timeout
- **No cron/scheduler** for EXPIRED transition
- **Easypanel host**: `https://apps-clip-ify-pocketbase.0itkyu.easypanel.host`
- **Test credentials**: `test@tes.com / 123123123`
- **GitHub repo**: `https://github.com/bridevmx/clip_pocketbase`
