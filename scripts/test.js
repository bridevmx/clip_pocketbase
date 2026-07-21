#!/usr/bin/env node
// scripts/test.js
//
// End-to-end smoke tests for the pocketbase-clip-mx plugin.
// Targets a live PocketBase instance (PocketHost or any public URL).
// Zero external dependencies — uses only Node.js built-ins.
//
// Usage:
//   node scripts/test.js
//
// Required environment variables (or edit the CONFIG block below):
//   PB_URL                 Public URL of your PocketBase instance
//                          e.g. https://my-app.pockethost.io
//   PB_SUPERUSER_EMAIL     Superuser email
//   PB_SUPERUSER_PASSWORD  Superuser password
//
// The script authenticates as superuser, runs every test case, prints a
// colour-coded report, and exits with code 1 if any test fails.

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const CONFIG = {
  pbUrl:              process.env.PB_URL                || "",
  superuserEmail:     process.env.PB_SUPERUSER_EMAIL    || "",
  superuserPassword:  process.env.PB_SUPERUSER_PASSWORD || "",
};

// ─── COLOUR HELPERS ──────────────────────────────────────────────────────────

const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  gray:   "\x1b[90m",
};

function pass(label) {
  console.log(`  ${c.green}✔${c.reset}  ${label}`);
}

function fail(label, detail) {
  console.log(`  ${c.red}✖${c.reset}  ${c.bold}${label}${c.reset}`);
  if (detail) console.log(`     ${c.red}${detail}${c.reset}`);
}

function info(msg) {
  console.log(`  ${c.cyan}ℹ${c.reset}  ${c.gray}${msg}${c.reset}`);
}

function section(title) {
  console.log(`\n${c.bold}${c.cyan}${title}${c.reset}`);
}

// ─── HTTP HELPER ─────────────────────────────────────────────────────────────

async function request(method, path, body, token) {
  const url = CONFIG.pbUrl.replace(/\/+$/, "") + path;
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = "Bearer " + token;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch (_) { json = { _raw: text }; }

  return { status: res.status, ok: res.ok, json };
}

// ─── ASSERTIONS ──────────────────────────────────────────────────────────────

let _passed = 0;
let _failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    pass(label);
    _passed++;
  } else {
    fail(label, detail);
    _failed++;
  }
}

function assertStatus(label, actual, expected) {
  assert(
    label,
    actual === expected,
    `expected HTTP ${expected}, got HTTP ${actual}`
  );
}

function assertField(label, obj, field) {
  assert(
    label,
    obj && obj[field] !== undefined && obj[field] !== null && obj[field] !== "",
    `field "${field}" is missing or empty in response: ${JSON.stringify(obj)}`
  );
}

// ─── TEST STATE ──────────────────────────────────────────────────────────────

let superuserToken = null;
let userToken      = null;
let createdOrderId = null;
let paymentRequestId = null;

// ─── VALIDATE CONFIG ─────────────────────────────────────────────────────────

function validateConfig() {
  section("0 · Configuration");

  assert(
    "PB_URL is set",
    !!CONFIG.pbUrl,
    "Set the PB_URL environment variable (e.g. https://my-app.pockethost.io)"
  );
  assert(
    "PB_SUPERUSER_EMAIL is set",
    !!CONFIG.superuserEmail,
    "Set the PB_SUPERUSER_EMAIL environment variable"
  );
  assert(
    "PB_SUPERUSER_PASSWORD is set",
    !!CONFIG.superuserPassword,
    "Set the PB_SUPERUSER_PASSWORD environment variable"
  );

  if (!CONFIG.pbUrl || !CONFIG.superuserEmail || !CONFIG.superuserPassword) {
    console.log(`\n${c.red}${c.bold}Aborting: missing required configuration.${c.reset}\n`);
    process.exit(1);
  }

  info(`Target: ${CONFIG.pbUrl}`);
}

// ─── TEST SUITES ─────────────────────────────────────────────────────────────

// 1. Superuser authentication
async function testSuperuserAuth() {
  section("1 · Superuser authentication");

  const res = await request("POST", "/api/collections/_superusers/auth-with-password", {
    identity: CONFIG.superuserEmail,
    password: CONFIG.superuserPassword,
  });

  assertStatus("POST /api/collections/_superusers/auth-with-password → 200", res.status, 200);
  assertField("Response contains token", res.json, "token");

  if (res.json && res.json.token) {
    superuserToken = res.json.token;
    info("Superuser token obtained");
  }
}

// 2. Create payment link — unauthenticated (guest)
async function testCreateLinkGuest() {
  section("2 · POST /api/clip/create-link (guest checkout)");

  const res = await request("POST", "/api/clip/create-link", {
    amount: 1.00,
    reference_collection: "test_products",
    reference_id: "TEST_ITEM_001",
  });

  // Clip API will be called — if CLIP_API_KEY is wrong this returns 500.
  // We accept both 200 (success) and 500 (Clip error) as valid responses
  // to distinguish plugin routing errors (404) from Clip credential issues.
  assert(
    "Route exists (not 404)",
    res.status !== 404,
    `Got 404 — the plugin hooks may not be loaded. Status: ${res.status}`
  );

  if (res.status === 200) {
    assertField("Response has order_id",          res.json, "order_id");
    assertField("Response has payment_url",        res.json, "payment_url");
    assertField("Response has payment_request_id", res.json, "payment_request_id");

    createdOrderId   = res.json.order_id;
    paymentRequestId = res.json.payment_request_id;

    info(`Order created: ${createdOrderId}`);
    info(`Payment URL:   ${res.json.payment_url}`);
  } else if (res.status === 500 || res.status === 400) {
    info(`Clip API returned ${res.status} — likely invalid CLIP_API_KEY on the instance.`);
    info("The plugin route exists and is reachable. Clip integration requires a real API key.");
  } else {
    fail("Unexpected status from create-link", `HTTP ${res.status}: ${JSON.stringify(res.json)}`);
    _failed++;
  }
}

// 3. Create payment link — authenticated user (register a temp user first)
async function testCreateLinkAuthenticated() {
  section("3 · POST /api/clip/create-link (authenticated user)");

  // Register a temporary test user.
  const tempEmail    = `cliptest_${Date.now()}@test.local`;
  const tempPassword = "TestPassword123!";

  const regRes = await request("POST", "/api/collections/users/records", {
    email:           tempEmail,
    password:        tempPassword,
    passwordConfirm: tempPassword,
  });

  if (!regRes.ok) {
    info(`Could not create test user (HTTP ${regRes.status}) — skipping authenticated test.`);
    info("This is expected if the 'users' collection has restricted create rules.");
    return;
  }

  // Authenticate as the test user.
  const authRes = await request("POST", "/api/collections/users/auth-with-password", {
    identity: tempEmail,
    password: tempPassword,
  });

  assertStatus("Test user auth → 200", authRes.status, 200);
  assertField("User token obtained", authRes.json, "token");

  if (!authRes.json || !authRes.json.token) return;
  userToken = authRes.json.token;

  // Create a payment link as authenticated user.
  const res = await request(
    "POST",
    "/api/clip/create-link",
    {
      amount: 1.00,
      reference_collection: "test_products",
      reference_id: "TEST_ITEM_AUTH_001",
    },
    userToken
  );

  assert(
    "Authenticated create-link route exists (not 404)",
    res.status !== 404,
    `Got 404 — hooks may not be loaded. Status: ${res.status}`
  );

  if (res.status === 200) {
    assertField("Response has order_id",   res.json, "order_id");
    assertField("Response has payment_url", res.json, "payment_url");
    info(`Authenticated order created: ${res.json.order_id}`);

    // If the guest test didn't get an order, use this one.
    if (!createdOrderId) {
      createdOrderId   = res.json.order_id;
      paymentRequestId = res.json.payment_request_id;
    }
  } else if (res.status === 500 || res.status === 400) {
    info(`Clip API returned ${res.status} — invalid CLIP_API_KEY. Route is reachable.`);
  }

  // Clean up the test user.
  if (regRes.json && regRes.json.id && superuserToken) {
    await request("DELETE", `/api/collections/users/records/${regRes.json.id}`, null, superuserToken);
    info("Test user deleted");
  }
}

// 4. Verify the clip_orders record was created in the DB
async function testOrderRecordExists() {
  section("4 · clip_orders record in the database");

  if (!createdOrderId) {
    info("Skipping — no order was created in previous tests (Clip API key may be invalid).");
    return;
  }

  const res = await request(
    "GET",
    `/api/collections/clip_orders/records/${createdOrderId}`,
    null,
    superuserToken
  );

  assertStatus("GET clip_orders record → 200", res.status, 200);
  assertField("Record has clip_payment_request_id", res.json, "clip_payment_request_id");

  assert(
    "Record status is CREATED",
    res.json && res.json.status === "CREATED",
    `Expected status CREATED, got: ${res.json && res.json.status}`
  );

  assert(
    "Record has reference_collection",
    res.json && res.json.reference_collection === "test_products",
    `Expected test_products, got: ${res.json && res.json.reference_collection}`
  );
}

// 5. Webhook — invalid payload (missing required fields)
async function testWebhookInvalidPayload() {
  section("5 · POST /api/clip/webhook — invalid payload");

  const res = await request("POST", "/api/clip/webhook", {
    unexpected_field: "value",
  });

  assert(
    "Invalid payload returns 400",
    res.status === 400,
    `Expected 400, got ${res.status}: ${JSON.stringify(res.json)}`
  );
}

// 6. Webhook — ignored origin (unknown source)
async function testWebhookIgnoredOrigin() {
  section("6 · POST /api/clip/webhook — ignored origin");

  const res = await request("POST", "/api/clip/webhook", {
    payment_request_id: "00000000-0000-0000-0000-000000000000",
    origin:             "pos-terminal",
    resource:           "CHECKOUT",
    resource_status:    "CREATED",
  });

  assertStatus("Unknown origin returns 200", res.status, 200);
  assert(
    "Response status is 'ignored'",
    res.json && res.json.status === "ignored",
    `Expected { status: 'ignored' }, got: ${JSON.stringify(res.json)}`
  );
}

// 7. Webhook — unknown payment_request_id (order not in DB)
async function testWebhookUnknownOrder() {
  section("7 · POST /api/clip/webhook — unknown payment_request_id");

  // Use a valid UUID format — Clip returns 404 for valid-but-unknown UUIDs,
  // 400 for malformed UUIDs. We test the valid-UUID path here.
  const res = await request("POST", "/api/clip/webhook", {
    payment_request_id: "00000000-0000-0000-0000-000000000000",
    resource:           "CHECKOUT",
    resource_status:    "CHECKOUT_CREATED",
  });

  assert(
    "Route exists and responds (not 404)",
    res.status !== 404,
    `Got 404 — hooks may not be loaded`
  );

  // Valid outcomes:
  //   200 clip_not_found  — Clip returned 404 (unknown UUID)
  //   200 order_not_found — Clip returned data but no matching order in DB
  //   200 clip_format_error — Clip returned 400
  //   502 — Clip API unreachable
  assert(
    "Returns 200 or 502",
    res.status === 200 || res.status === 502,
    `Unexpected status: ${res.status} — ${JSON.stringify(res.json)}`
  );

  if (res.status === 200) {
    info(`Webhook responded: ${res.json && res.json.status}`);
  } else {
    info("Clip API returned 502 — network or auth issue");
  }
}

// 8. Webhook — real payment_request_id (end-to-end if order was created)
async function testWebhookRealOrder() {
  section("8 · POST /api/clip/webhook — real payment_request_id");

  if (!paymentRequestId) {
    info("Skipping — no payment_request_id available (Clip API key may be invalid).");
    return;
  }

  // Use Clip v2 webhook payload format.
  const res = await request("POST", "/api/clip/webhook", {
    payment_request_id: paymentRequestId,
    resource:           "CHECKOUT",
    resource_status:    "CHECKOUT_CREATED",
  });

  assert(
    "Webhook with real ID responds (not 404)",
    res.status !== 404,
    `Got 404 — hooks may not be loaded`
  );

  assert(
    "Returns 200 or 502",
    res.status === 200 || res.status === 502,
    `Unexpected status: ${res.status} — ${JSON.stringify(res.json)}`
  );

  if (res.status === 200) {
    assertField("Response has processed_status", res.json, "processed_status");
    info(`Order status after webhook: ${res.json.processed_status}`);
  } else {
    info("Clip API re-query failed (502)");
  }
}

// 9. Collection access rules — clip_orders is not publicly listable
async function testCollectionAccessRules() {
  section("9 · Collection access rules");

  // Unauthenticated request to list clip_orders should be forbidden.
  const res = await request("GET", "/api/collections/clip_orders/records");

  assert(
    "clip_orders list is not publicly accessible (403 or 401)",
    res.status === 403 || res.status === 401,
    `Expected 403/401, got ${res.status} — clip_orders may be publicly readable`
  );

  // Superuser should be able to list clip_orders.
  const adminRes = await request(
    "GET",
    "/api/collections/clip_orders/records",
    null,
    superuserToken
  );

  assertStatus("Superuser can list clip_orders → 200", adminRes.status, 200);
}

// 10. Collection access rules — clip_payments is not publicly accessible
async function testClipPaymentsAccessRules() {
  section("10 · clip_payments access rules");

  const res = await request("GET", "/api/collections/clip_payments/records");

  assert(
    "clip_payments list is not publicly accessible (403 or 401)",
    res.status === 403 || res.status === 401,
    `Expected 403/401, got ${res.status} — clip_payments may be publicly readable`
  );
}

// ─── CLEANUP ─────────────────────────────────────────────────────────────────

async function cleanup() {
  section("Cleanup");

  if (createdOrderId && superuserToken) {
    // Delete test orders created during the test run.
    const res = await request(
      "DELETE",
      `/api/collections/clip_orders/records/${createdOrderId}`,
      null,
      superuserToken
    );
    if (res.ok) {
      info(`Test order ${createdOrderId} deleted`);
    } else {
      info(`Could not delete test order ${createdOrderId} — delete it manually from the Admin UI`);
    }
  }
}

// ─── REPORT ──────────────────────────────────────────────────────────────────

function printReport() {
  const total = _passed + _failed;
  console.log("\n" + "─".repeat(52));
  console.log(`${c.bold}Results${c.reset}`);
  console.log("─".repeat(52));
  console.log(`  Total:   ${total}`);
  console.log(`  ${c.green}Passed:  ${_passed}${c.reset}`);
  if (_failed > 0) {
    console.log(`  ${c.red}Failed:  ${_failed}${c.reset}`);
  } else {
    console.log(`  Failed:  ${_failed}`);
  }
  console.log("─".repeat(52));

  if (_failed === 0) {
    console.log(`\n${c.green}${c.bold}All tests passed. ✔${c.reset}\n`);
  } else {
    console.log(`\n${c.red}${c.bold}${_failed} test(s) failed. ✖${c.reset}\n`);
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${c.bold}pocketbase-clip-mx — E2E smoke tests${c.reset}`);
  console.log("─".repeat(52));

  validateConfig();

  await testSuperuserAuth();

  // Abort if we have no auth token — remaining tests depend on it.
  if (!superuserToken) {
    console.log(`\n${c.red}${c.bold}Cannot continue without a superuser token.${c.reset}\n`);
    printReport();
    process.exit(1);
  }

  await testCreateLinkGuest();
  await testCreateLinkAuthenticated();
  await testOrderRecordExists();
  await testWebhookInvalidPayload();
  await testWebhookIgnoredOrigin();
  await testWebhookUnknownOrder();
  await testWebhookRealOrder();
  await testCollectionAccessRules();
  await testClipPaymentsAccessRules();

  await cleanup();

  printReport();
  process.exit(_failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n${c.red}Unhandled error: ${err.message}${c.reset}\n`);
  process.exit(1);
});
