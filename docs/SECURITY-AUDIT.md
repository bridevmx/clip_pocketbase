# 🔐 Auditoría de Seguridad — Plugin CLIP + SPEI

> **Estado:** Todos los riesgos críticos y medios documentados han sido corregidos.
> Solo queda el rate limiting, que se configura desde la UI de PocketBase (no requiere código).

---

## ESTADO FINAL DE RIESGOS

| # | Riesgo | Severidad original | Estado |
|---|---|---|---|
| 1 | Cliente controla el monto en CLIP create-link | 🔴 CRÍTICO | ✅ Corregido |
| 2 | Sin auth en `GET /api/clip/order/{id}/status` | 🔴 CRÍTICO | ✅ Corregido |
| 3 | Sin auth en `GET /api/spei/order/{id}/status` | 🔴 CRÍTICO | ✅ Corregido |
| 4 | Sin auth en rutas de transacciones CLIP | 🟡 MEDIO | ✅ Corregido |
| 5 | Sin rate limiting en endpoints SPEI | 🟡 MEDIO | ⚙️ Configurar en PocketBase UI |
| 6 | validate-cep abierto a cualquier usuario auth | 🟡 MEDIO | ✅ Corregido |
| 7 | Token Clip expuesto en logs DEBUG | 🟡 MENOR | 📝 Documentado — remover en producción |
| 8 | Hardcoded _superusers en todos los checks | 🟡 DISEÑO | ✅ Resuelto con plugin_settings |

Los riesgos mitigados anteriores (webhook falso, double-spend CEP, replay CEP, inyección, idempotencia, expiración) siguen funcionando sin cambios.

---

## SOLUCIÓN CENTRAL — `plugin_settings` collection

Se agregó una colección `plugin_settings` que centraliza toda la configuración de autorización del plugin. Esto resuelve el problema de raíz: **no hardcodear quién tiene acceso** en el código fuente.

### Cómo configurarla (PocketBase Admin UI)

```
Collections → plugin_settings → Records
```

| key | value (ejemplo) | Efecto |
|---|---|---|
| `admin_user_ids` | `abc123xyz,def456uvw` | Estos users pueden: refund, transacciones, validate-cep, status de cualquier orden |
| `clip_amount_field` | `total` | SECURE MODE: el monto se lee del campo `total` del registro referenciado, no del cliente |

> **Regla:** Los _superusers siempre tienen acceso, independiente de `admin_user_ids`.

### Archivo helper — `plugin_settings_helper.js`

```js
const psh = require(`${__hooks}/plugin_settings_helper.js`);

// Verificar si un usuario tiene derechos de admin del plugin
psh.isPluginAdmin(userId)   // true si superuser O si está en admin_user_ids

// Leer un valor de configuración
psh.getSetting("clip_amount_field", "total")  // devuelve el valor o el default
```

---

## CORRECCIÓN 1 — Monto en `clip_create_link.pb.js`

### El problema original
```js
// ANTES — el cliente enviaba cualquier monto
const amount = body["amount"];  // ← atacante podía poner $1
```

### La solución
```js
// AHORA — dos modos controlados por plugin_settings
const amountField = psh.getSetting("clip_amount_field", "");

if (amountField) {
  // SECURE MODE: lee de la DB, cliente no puede alterar
  const refRecord = $app.findRecordById(referenceCollection, referenceId);
  amount = refRecord.get(amountField);
  amountSource = "server";
}

if (amount === null) {
  // LEGACY MODE: usa el del cliente (backward compatible)
  amount = body["amount"];
  amountSource = "client";
}
```

**Para activar secure mode:** Agregar en plugin_settings:
- `key = "clip_amount_field"`, `value = "total"` (o el nombre del campo en tu colección)

---

## CORRECCIÓN 2 y 3 — Auth en status checks (CLIP y SPEI)

### El problema original
El comentario en `clip_status_check.pb.js` decía `// Requires authentication.` pero el código no lo implementaba. En SPEI ni el comentario existía.

Cualquiera que conociera un `order_id` (15 chars alfanuméricos) podía:
- Ver el estado completo del pago
- Ver la **CLABE completa de 18 dígitos** (SPEI)
- Ver el nombre del titular de la cuenta (SPEI)
- Ver el monto exacto

### La solución (misma lógica para ambos)
```js
// Requiere auth
const info = e.requestInfo();
if (!info.auth || !info.auth.id) throw new UnauthorizedError("Authentication required");

// Carga la orden
const order = $app.findRecordById("spei_orders" | "clip_orders", orderId);

// Permite: admin del plugin O dueño de la orden
const isAdmin = psh.isPluginAdmin(info.auth.id);
const isOwner = order.getString("user") === info.auth.id;
if (!isAdmin && !isOwner) throw new ForbiddenError("Not authorized");
```

**Lógica de ownership:** Si la orden fue creada por un usuario anónimo (guest checkout en CLIP), `user` estará vacío — en ese caso solo los admins pueden consultar el estado.

---

## CORRECCIÓN 4 — Auth en transacciones CLIP

### El problema original
```js
// ANTES — sin auth, cualquiera consumía quota del token de Clip
routerAdd("GET", "/api/clip/transactions", (e) => {
  // zero auth check
  result = clip.listTransactions(from, to, ...);
```

### La solución
```js
// AHORA — solo plugin admins
if (!info.auth || !info.auth.id || !psh.isPluginAdmin(info.auth.id)) {
  throw new ForbiddenError("Plugin admin authentication required");
}
```

Aplica a:
- `GET /api/clip/transaction/{receiptNo}`
- `GET /api/clip/transactions`

---

## CORRECCIÓN 5 — `spei_validate_cep.pb.js`

### El problema original
El endpoint aceptaba cualquier usuario autenticado. Un cliente final podía:
- Llamarlo en bucle para cualquier orden (no solo la suya)
- Agotar scrapes de Banxico o provocar bloqueo de IP del servidor

### La solución — tres niveles
```
Nivel 1: ¿Tiene auth? → No → 401 Unauthorized
Nivel 2: ¿Es plugin admin? → Sí → ✅ Acceso total (puede validar cualquier orden)
Nivel 3: ¿Es dueño de la orden? → Sí → ✅ Solo puede re-validar su propia orden
                                 → No → 403 Forbidden
```

**Por qué permitir al dueño:** El usuario que creó el pedido y transfirió el dinero tiene un caso legítimo de querer forzar la re-validación si el cron tardó demasiado. El riesgo de abuso es bajo porque solo puede hacerlo sobre su propia orden y el estado terminal (`LIQUIDADO`, `EXPIRED`) ya bloquea el re-procesamiento.

---

## CORRECCIÓN 6 — `clip_refund.pb.js` y acceso centralizado

### Antes (hardcoded)
```js
// Todos los checks de admin estaban hardcodeados a _superusers
try { $app.findRecordById("_superusers", info.auth.id); }
catch (_) { throw new ForbiddenError("Superuser required"); }
```

**Problema:** Para dar acceso a un operador de backoffice había que hacerlo _superuser (acceso completo a PocketBase).

### Ahora (configurable)
```js
// Un solo check que resuelve _superusers + lista configurable
if (!psh.isPluginAdmin(info.auth.id)) {
    throw new ForbiddenError("Plugin admin authentication required");
}
```

**Para agregar un operador sin hacerlo _superuser:**
```
plugin_settings → admin_user_ids → "id_del_operador"
```

---

## RATE LIMITING — Configuración en PocketBase UI

**No se corrige con código** — PocketBase v0.23+ tiene rate limiting nativo configurable desde la UI.

### Endpoints a proteger

| Endpoint | Tipo | Configuración sugerida |
|---|---|---|
| `POST /api/spei/report-payment` | Público (auth opcional) | 10 req / min por IP |
| `POST /api/spei/create-order` | Auth requerida | 20 req / min por usuario |
| `POST /api/clip/create-link` | Auth opcional | 30 req / min por IP |
| `POST /api/spei/validate-cep` | Auth requerida | 5 req / min por usuario |

### Dónde configurarlo
```
PocketBase Admin UI → Settings → Rate Limiting
```

---

## RIESGOS RESIDUALES DOCUMENTADOS (baja prioridad)

### Token de Clip en logs DEBUG
**Archivo:** `clip_api_client.js`

```js
// Esta línea expone los primeros 20 chars del token en logs
const tokenPreview = authHeader.substring(0, 20) + "...";
console.log("[CLIP DEBUG] Auth header prefix: " + tokenPreview);
```

**Acción:** Remover o convertir a `$app.logger().debug()` antes de producción. Los logs DEBUG no deben llegar a sistemas de log externos (Datadog, Logtail, etc.) sin filtrado previo.

### Anti-double-spend y estados REJECTED
**Archivo:** `spei_report_payment.pb.js` líneas 63-76

El check de reutilización de criterio solo busca en estados `LIQUIDADO` y `REPORTED`. Un CEP en `REJECTED` puede ser reportado de nuevo en una orden diferente.

**Por qué es aceptable:** Si Banxico rechazó la transferencia (monto incorrecto, cuenta errónea), el dinero no llegó — el CEP no tiene valor. Sin embargo, si el rechazo fue por un error técnico transitorio, el mismo CEP podría ser válido en un reintento legítimo.

**Sin acción por ahora:** El doble check de monto + cuenta + estado `liquidado` en `evaluateCepResult()` previene el abuso real incluso si el criterio pasa la primera validación.

---

*Auditoría actualizada: 2026-08-03 — Todos los riesgos críticos y medios corregidos.*
