# SPEI Plugin — Security Analysis

> **Date**: 2026-07-22
> **Status**: CRITICAL — Multiple vulnerabilities identified
> **Priority**: Fix before production use

---

## Executive Summary

The SPEI/CEP plugin has **10 identified vulnerabilities** that could allow payment fraud, double-spending, and unauthorized access. The most critical is **#1: Stale CEP validation** — a user could report a payment using an old CEP that was already liquidated.

---

## Vulnerability Matrix

| # | Severity | Name | Status |
|---|----------|------|--------|
| 1 | 🔴 CRITICAL | Stale CEP validation | ❌ NOT PROTECTED |
| 2 | 🔴 CRITICAL | CEP reuse across orders | ❌ NOT PROTECTED |
| 3 | 🟠 HIGH | Declared amount ≠ real amount | ⚠️ PARTIAL |
| 4 | 🟠 HIGH | No time limit for reporting | ❌ NOT PROTECTED |
| 5 | 🟡 MEDIUM | Declared amount > order amount | ❌ NOT PROTECTED |
| 6 | 🟡 MEDIUM | CEP timing attack | ❌ NOT PROTECTED |
| 7 | 🟢 LOW | Payment canceled after liquidado | ⚠️ PARTIAL |
| 8 | 🟡 MEDIUM | Race condition in report | ❌ NOT PROTECTED |
| 9 | 🟢 LOW | Fake reference spam | ⚠️ MITIGATED |
| 10 | 🟡 MEDIUM | Same amount multiple orders | ❌ NOT PROTECTED |

---

## Detailed Analysis

### 🔴 #1: Stale CEP Validation (CRITICAL)

**Scenario**: User makes a transfer today but uses a reference/tracking code from a transfer made weeks ago that was already liquidated.

**Current behavior**: The plugin only validates that the CEP status is "liquidado". It does NOT check if the CEP's processing date is recent.

**Attack flow**:
```
1. User creates order for $1,000 MXN (order_id: ABC123)
2. User finds an old CEP from a $1,000 transfer made 30 days ago
3. User reports payment with old reference
4. CEP returns "liquidado" with old processing date
5. Plugin marks order as LIQUIDADO
6. User never actually paid — they reused an old receipt
```

**Fix**: Add date validation in `evaluateCepResult`:
```javascript
// Parse CEP processing date
var cepDate = parseCepDate(cepResult.processingDate); // "21/07/2026 14:30:00"
var now = new Date();
var diffHours = (now - cepDate) / (1000 * 60 * 60);

if (diffHours > 24) {
  return { isMatch: false, newStatus: "REJECTED", reason: "CEP too old", shouldRetry: false };
}
```

---

### 🔴 #2: CEP Reuse Across Orders (CRITICAL)

**Scenario**: User creates multiple orders and reports the same payment for all of them.

**Current behavior**: No check if a CEP (tracking code + amount + account) was already used in another order.

**Attack flow**:
```
1. User creates 5 orders, each for $1,000 MXN
2. User makes ONE transfer of $1,000
3. User reports the same tracking code for all 5 orders
4. All 5 orders marked as LIQUIDADO
5. User paid $1,000 but received $5,000 worth of goods
```

**Fix**: Add unique constraint check before validation:
```javascript
// Check if this CEP was already used
var existingCep = $app.findRecordsByFilter(
  "cep_verifications",
  `tracking_code="${criterio}" && amount=${montoDeclarado} && beneficiary_account="${receptorData.cuenta}"`,
  "", 1, 0
);
if (existingCep.length > 0) {
  throw new BadRequestError("This payment has already been reported for another order");
}
```

---

### 🟠 #3: Declared Amount ≠ Real Amount (HIGH)

**Scenario**: User declares a lower amount than what they actually paid.

**Current behavior**: `evaluateCepResult` checks `Math.abs(cepAmount - declared) < 0.01`. If the user declares LESS than the CEP amount, it still passes.

**Attack flow**:
```
1. User creates order for $1,000 MXN
2. User actually pays $500 MXN
3. User declares $500 as monto_declarado
4. CEP shows $500 — matches declared amount
5. Order marked as LIQUIDADO for $500
6. But the order was for $1,000 — user underpaid
```

**Fix**: Validate against order amount, not declared amount:
```javascript
// In spei_report_payment.pb.js — validate declared >= order amount
var orderAmount = order.getFloat("amount");
if (parseFloat(montoDeclarado) < orderAmount) {
  throw new BadRequestError("Declared amount is less than order amount");
}
```

---

### 🟠 #4: No Time Limit for Reporting (HIGH)

**Scenario**: User tries to report a payment for an order that already expired.

**Current behavior**: No validation of `submitted_at` vs `created`.

**Attack flow**:
```
1. User creates order on Monday
2. Order expires after 24h (Tuesday)
3. User makes payment on Friday
4. User reports payment on Friday
5. System accepts it — no expiration check
```

**Fix**: Add expiration check:
```javascript
var created = new Date(order.getDate("created"));
var now = new Date();
var diffHours = (now - created) / (1000 * 60 * 60);
if (diffHours > 24) {
  throw new BadRequestError("Order has expired");
}
```

---

### 🟡 #5: Declared Amount > Order Amount (MEDIUM)

**Scenario**: User declares more than what they owe.

**Current behavior**: No validation that `monto_declarado <= amount`.

**Attack flow**:
```
1. User creates order for $100 MXN
2. User declares $1,000 as monto_declarado
3. CEP shows $1,000 — matches declared amount
4. Order marked as LIQUIDADO for $1,000
5. User overpaid but system doesn't care
```

**Fix**: Validate declared <= order amount:
```javascript
var orderAmount = order.getFloat("amount");
if (parseFloat(montoDeclarado) > orderAmount) {
  throw new BadRequestError("Declared amount exceeds order amount");
}
```

---

### 🟡 #6: CEP Timing Attack (MEDIUM)

**Scenario**: User makes a real transfer but with a different amount than declared.

**Current behavior**: System validates against `monto_declarado`, not against the order amount.

**Attack flow**:
```
1. User creates order for $1,000 MXN
2. User actually pays $1,000 but declares $500
3. CEP shows $1,000, declared is $500 — mismatch
4. But if user declares $1,000, it matches
5. No validation that declared == order amount
```

**Fix**: Always validate against order amount:
```javascript
// Use order amount for validation, not declared amount
var evaluation = spei.evaluateCepResult(
  cepResult.data,
  String(orderAmount), // Use order amount, not declared
  receptorData.cuenta
);
```

---

### 🟢 #7: Payment Canceled After Liquidado (LOW)

**Scenario**: Bank cancels a transfer after it was liquidated.

**Current behavior**: Plugin only checks status once. If CEP later shows "cancelado", no action taken.

**Mitigation**: The CEP status is checked at report time. If it says "liquidado", we trust it. Banxico rarely reverses liquidated transfers.

**Future fix**: Periodic re-validation of LIQUIDADO orders.

---

### 🟡 #8: Race Condition in Report (MEDIUM)

**Scenario**: Two users report the same payment simultaneously.

**Current behavior**: No locking mechanism. Both requests could succeed.

**Attack flow**:
```
1. User A creates order for $1,000
2. User B finds the same CEP
3. Both report simultaneously
4. Both orders marked as LIQUIDADO
```

**Fix**: Use PocketBase transaction with unique constraint:
```javascript
$app.runInTransaction((txApp) => {
  // Check if CEP already used
  var existing = txApp.findRecordsByFilter("cep_verifications", `tracking_code="${criterio}"`, "", 1, 0);
  if (existing.length > 0) {
    throw new BadRequestError("Payment already reported");
  }
  // ... proceed
});
```

---

### 🟢 #9: Fake Reference Spam (LOW)

**Scenario**: User submits fake references to exhaust retry attempts.

**Current behavior**: Each fake reference triggers a CEP validation (30s timeout). After 12 retries, order goes to MANUAL_REVIEW.

**Mitigation**: Already handled — max 12 retries, then manual review.

**Future fix**: Rate limiting on report-payment endpoint.

---

### 🟡 #10: Same Amount Multiple Orders (MEDIUM)

**Scenario**: User creates multiple orders with the same amount and reports the same payment.

**Current behavior**: No validation of duplicates by amount + account.

**Attack flow**:
```
1. User creates 10 orders, each for exactly $500.00 MXN
2. User makes ONE transfer of $500
3. User reports the same tracking code for all 10 orders
4. All 10 orders marked as LIQUIDADO
```

**Fix**: Same as #2 — check for existing CEP with same tracking code + amount + account.

---

## Recommended Fixes (Priority Order)

### Immediate (Before Production)

1. **#1 Stale CEP**: Add date validation (max 24h old)
2. **#2 CEP Reuse**: Add unique check for tracking_code + amount + account
3. **#3 Amount Validation**: Validate declared >= order amount
4. **#4 Expiration**: Add 24h expiration check

### Short Term

5. **#5 Amount Cap**: Validate declared <= order amount
6. **#6 Timing**: Use order amount for validation, not declared
7. **#8 Race Condition**: Add transaction locking

### Long Term

8. **#7 Re-validation**: Periodic check of LIQUIDADO orders
9. **#9 Rate Limiting**: Limit report-payment attempts per user
10. **#10 Monitoring**: Alert on suspicious patterns

---

## Implementation Plan

### Phase 1: Critical Fixes (This Sprint)

```javascript
// In spei_report_payment.pb.js — add BEFORE CEP validation:

// 1. Check order expiration (24h)
var created = new Date(order.getDate("created"));
var now = new Date();
var diffHours = (now - created) / (1000 * 60 * 60);
if (diffHours > 24) {
  throw new BadRequestError("Order has expired");
}

// 2. Validate declared amount
var orderAmount = order.getFloat("amount");
var declared = parseFloat(montoDeclarado);
if (declared < orderAmount) {
  throw new BadRequestError("Declared amount is less than order amount");
}
if (declared > orderAmount * 1.1) { // Allow 10% tolerance for fees
  throw new BadRequestError("Declared amount exceeds order amount");
}

// 3. Check for CEP reuse
var existingCep = $app.findRecordsByFilter(
  "cep_verifications",
  `tracking_code="${criterio}" && amount=${declared}`,
  "", 1, 0
);
if (existingCep.length > 0) {
  throw new BadRequestError("This payment has already been reported");
}
```

### Phase 2: CEP Date Validation

```javascript
// In spei_api_client.js — add to evaluateCepResult:

function parseCepDate(dateStr) {
  // "21/07/2026 14:30:00" → Date object
  var parts = dateStr.split(" ");
  var dateParts = parts[0].split("/");
  var timeParts = parts[1].split(":");
  return new Date(
    parseInt(dateParts[2]),
    parseInt(dateParts[1]) - 1,
    parseInt(dateParts[0]),
    parseInt(timeParts[0]),
    parseInt(timeParts[1]),
    parseInt(timeParts[2])
  );
}

// In evaluateCepResult:
if (cepResult.processingDate) {
  var cepDate = parseCepDate(cepResult.processingDate);
  var now = new Date();
  var diffHours = (now - cepDate) / (1000 * 60 * 60);
  if (diffHours > 24) {
    return { isMatch: false, newStatus: "REJECTED", reason: "CEP too old (>24h)", shouldRetry: false };
  }
}
```

---

## Monitoring & Alerts

Add logging for suspicious patterns:

```javascript
// Log potential fraud attempts
$app.logger().warn("[SPEI SECURITY] Suspicious activity", {
  "order_id": orderId,
  "criterio": criterio,
  "declared_amount": montoDeclarado,
  "order_amount": orderAmount,
  "cep_age_hours": diffHours,
  "ip": info.remoteAddr,
  "user_agent": info.headers["user-agent"],
});
```

---

## Conclusion

The SPEI plugin has **critical security vulnerabilities** that must be fixed before production use. The most dangerous is **CEP reuse** — a single payment could be reported for multiple orders.

**Recommended action**: Implement Phase 1 fixes immediately, add monitoring, and conduct a security audit before going live.
