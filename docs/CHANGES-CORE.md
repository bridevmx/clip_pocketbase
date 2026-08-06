# 🔌 Plugin Core — CLIP + SPEI para PocketBase

> Cambios y mejoras reales al **plugin de pagos** respecto al repositorio original [`bridevmx/clip_pocketbase`](https://github.com/bridevmx/clip_pocketbase).
>
> Este documento NO incluye lógica de negocio específica de ningún proyecto.
> El objetivo es que el plugin sea **copiable y funcional en cualquier proyecto PocketBase existente en producción**.

---

## 📁 Archivos del Plugin (lo que copias a tu proyecto)

```
pb_hooks/
├── clip_00_bootstrap.pb.js       ← Sin cambios vs GitHub
├── clip_api_client.js             ← ✏️ MEJORADO (+funciones, +constantes)
├── clip_create_link.pb.js         ← 🔒 CORREGIDO (resolución de monto segura)
├── clip_webhook.pb.js             ← Sin cambios vs GitHub
├── clip_status_check.pb.js        ← 🔒 CORREGIDO (+auth, +ownership check)
├── clip_refund.pb.js              ← 🔒 CORREGIDO (isPluginAdmin vs _superusers)
├── clip_transactions.pb.js        ← 🔒 CORREGIDO (+auth en ambas rutas)
│
├── spei_00_bootstrap.pb.js        ← Sin cambios vs GitHub
├── spei_api_client.js              ← ✏️ MEJORADO (+4 funciones de utilidad)
├── spei_create_order.pb.js         ← ✏️ MEJORADO (server-side amount + atómico)
├── spei_report_payment.pb.js       ← Sin cambios vs GitHub
├── spei_status_check.pb.js         ← 🔒 CORREGIDO (+auth, +ownership check)
├── spei_validate_cep.pb.js         ← 🔒 CORREGIDO (isPluginAdmin OR owner)
├── spei_cep_form.pb.js             ← Sin cambios vs GitHub
├── spei_cron_retry.pb.js           ← ★ NUEVO (reintento automático CEP)
│
├── plugin_settings_helper.js       ← ★ NUEVO (helper centralizado de autorización)
├── my_app_clip_handler.pb.js       ← PUNTO DE EXTENSIÓN (editar en cada proyecto)
└── my_app_spei_handler.pb.js       ← PUNTO DE EXTENSIÓN (editar en cada proyecto)

pb_migrations/  (solo las del plugin)
├── 1721500000_clip_collections.js
├── 1721500001_fix_clip_orders_partial_index.js
├── 1721500002_add_refund_fields.js
├── 1721500003_spei_collections.js
├── 1721500004_spei_banks_data.js
├── 1785454996_updated_cep_verifications.js    ← ★ NUEVO (cascade delete fix)
└── 1785790000_plugin_settings.js              ← ★ NUEVO (colección de config)
```

---

## ✏️ Cambio 1 — `clip_api_client.js`

**Tamaño:** 8,176 → 8,407 bytes

Se agregaron **2 funciones nuevas** y **constantes de error** sin modificar el comportamiento existente.

### Función: `clipGetTransaction(receiptNo)`
Consulta el detalle de una transacción completada.
```js
// Clip API: GET /transactions/{receipt_no}
function clipGetTransaction(receiptNo) {
  return clipApiRequest("GET", "/transactions/" + receiptNo, null, 15);
}
```

### Función: `clipListTransactions(from, to, page, perPage)`
Lista transacciones en un rango de fechas. Valida que el rango no exceda 30 días antes de llamar a Clip.
```js
// Clip API: GET /transactions?from=...&to=...
// Valida: diffDays > 30 → retorna error 400 sin llamar a Clip
function clipListTransactions(from, to, page, perPage) { ... }
```

### Constantes de error exportadas
```js
module.exports = {
  // existentes sin cambio...
  request, normaliseClipStatus, refund,

  // NUEVAS
  getTransaction,
  listTransactions,
  ERR_FORMAT:    "002",  // Error de formato/validación en request
  ERR_NOT_FOUND: "021",  // payment_request_id no existe en Clip
  REFUND_ERRORS: {
    INSUFFICIENT_BALANCE:  "INSUFFICIENT_BALANCE",
    REFUND_NOT_ALLOWED:    "REFUND_NOT_ALLOWED",
    TRANSACTION_NOT_FOUND: "TRANSACTION_NOT_FOUND",
  },
};
```

**Por qué:** Estandarizar el manejo de errores en los hooks que usan el cliente, sin repetir strings mágicos.

---

## ✏️ Cambio 2 — `spei_api_client.js`

**Tamaño:** 14,571 → 15,044 bytes

Se agregaron **4 funciones de utilidad** sin modificar el scraper ni el parser CEP existentes.

### Función: `formatCepDate(dateInput)`
Convierte un Date/ISO a `"DD-MM-YYYY"` en zona horaria `America/Mexico_City`.
Necesaria porque Banxico CEP exige ese formato exacto y la zona horaria de México.
```js
spei.formatCepDate(order.getString("created")); // → "03-08-2026"
```

### Función: `parseCepDate(dateStr)`
Convierte `"DD/MM/YYYY HH:MM:SS"` (formato de respuesta Banxico) a un objeto `Date`.
```js
spei.parseCepDate("03/08/2026 14:30:00"); // → Date object
```

### Función: `evaluateCepResult(cepResult, declaredAmount, expectedAccount)`
Evalúa el resultado del scraper contra los datos de la orden. Centraliza toda la lógica de verificación.

**Retorna:**
```js
{
  isMatch:     true/false,   // true = transferencia confirmada exacta
  newStatus:   "LIQUIDADO"|"REJECTED"|null,
  reason:      "amount mismatch" | null,
  shouldRetry: true/false    // true = está en proceso, reintentar más tarde
}
```

**Validaciones que realiza:**
- Monto declarado vs monto en CEP (tolerancia < $0.01)
- Cuenta beneficiaria declarada vs cuenta en CEP (exacta)
- Estado en Banxico = `"liquidado"`
- CEP no tiene más de **24 horas** de antigüedad (seguridad anti-reutilización)

### Función: `resolveReceptorFromOrder(app, order)`
Resuelve el código de banco receptor y la CLABE a partir del registro `spei_orders`, buscando en `spei_settings` con fallback.

Si no hay `bank_code` explícito, **deduce el código Banxico de 5 dígitos** a partir de los primeros 3 dígitos de la CLABE:

```js
// Mapa estándar Banxico (prefijo CLABE → código institución)
"012" → "40012"  // BBVA
"072" → "40072"  // Banorte
"002" → "40002"  // Banamex
"014" → "40014"  // Santander
"021" → "40021"  // HSBC
"044" → "40044"  // Scotiabank
"058" → "40058"  // Banregio
"062" → "40062"  // Afirme
"127" → "40127"  // Azteca
"137" → "40137"  // Coppel
"638" → "90638"  // Spin by OXXO
"846" → "40846"  // STP
```

**Por qué:** Elimina la necesidad de configurar manualmente el código de banco — basta con la CLABE.

---

## ✏️ Cambio 3 — `spei_create_order.pb.js`

**Tamaño:** 3,092 → 5,318 bytes

Reescrito completamente. Mantiene el mismo endpoint `POST /api/spei/create-order` pero con mejoras críticas de seguridad.

### Mejora A: El monto se resuelve server-side
El cliente **no puede enviar el monto**. Se obtiene del registro referenciado en la DB:
```js
// El servidor lee el total desde la orden original
finalAmount = customerOrder.get("total") || 0;
```

### Mejora B: Transacción atómica
La creación del registro usa `$app.runInTransaction()` para garantizar consistencia:
```js
$app.runInTransaction((txApp) => {
  const order = new Record(...);
  order.set("amount", finalAmount);        // monto del servidor, no del cliente
  order.set("spei_settings", speiSettings.id);
  order.set("cuenta_beneficiaria", speiSettings.getString("clabe"));
  txApp.save(order);
});
```

### Mejora C: Parámetros vinculados en filtros
```js
// ✅ Correcto — evita SQL injection
$app.findFirstRecordByFilter(
  "spei_settings",
  "is_active = true",
  { } // sin interpolación de strings de usuario
);
```

### Respuesta del endpoint (sin cambios en el contrato)
```js
// POST /api/spei/create-order
// Body: { reference_collection, reference_id }
// Respuesta:
{
  order_id: "abc123",
  status: "PENDING",
  spei_settings: {
    clabe: "646180157034789451",
    bank_name: "STP",
    account_holder: "Mi Empresa SA de CV"
  }
}
```

---

## ★ Nuevo — `spei_cron_retry.pb.js`

**Este archivo no existe en el repositorio GitHub original.**

Implementa el **ciclo de verificación automática CEP** que completa el flujo de pagos SPEI sin intervención manual.

### Cómo funciona

```
Cada 2 minutos (cron):
  Busca spei_orders donde status='REPORTED' y next_retry_at <= ahora
      ↓
  spei.resolveReceptorFromOrder() → obtiene CLABE y código banco
      ↓
  spei.validate() → scraper Banxico CEP
      ↓
  spei.evaluateCepResult()
      ├── isMatch=true  → status="LIQUIDADO" → $app.save() → tu handler
      ├── shouldRetry   → next_retry_at = ahora + 5min, retry_count++
      └── no match      → status="REJECTED"
  
  Si retry_count > 12 → status="MANUAL_REVIEW"
      ↓
  cep_verifications → upsert del registro de auditoría
```

### Registro del cron
```js
cronAdd("spei_auto_retry_cep", "*/2 * * * *", () => {
  // Procesa hasta 20 órdenes por ciclo
  // Máximo 12 reintentos por orden (~1 hora de ventana)
  // Valida que el CEP no tenga más de 24h de antigüedad
});
```

### Campos que necesita en `spei_orders`
```
criterio        — referencia (7 dígitos) o clave de rastreo (8-30 chars)
emisor          — código banco emisor (5 dígitos)
monto_declarado — monto que el usuario declaró haber transferido
retry_count     — contador de intentos (actualizado por el cron)
next_retry_at   — fecha del próximo reintento (controlada por el cron)
submitted_at    — fecha en que el usuario reportó la transferencia
```

---

## ★ Nuevo — `1785454996_updated_cep_verifications.js`

Hace que la relación `order` en `cep_verifications` sea **required** y tenga **cascadeDelete: true**.

```js
// Antes: optional, cascadeDelete: false
// Después: required: true, cascadeDelete: true
```

**Por qué:** Al eliminar una `spei_orders`, su `cep_verification` asociada se elimina automáticamente, evitando registros huérfanos de auditoría.

---

## 🔌 Puntos de Extensión (lo que SÍ editas en cada proyecto)

El plugin dispara eventos en colecciones estándar. Tu proyecto solo necesita escuchar esos eventos:

### Para CLIP — `my_app_clip_handler.pb.js`

```js
/// <reference path="../pb_data/types.d.ts" />
onRecordAfterUpdateSuccess((e) => {
    const status        = e.record.getString("status");
    const refCollection = e.record.getString("reference_collection");
    const refId         = e.record.getString("reference_id");
    const receiptNo     = e.record.getString("receipt_no");
    const amountPaid    = e.record.get("amount_paid");

    if (status === "COMPLETED") {
        // 👉 Tu lógica aquí:
        // const item = $app.findRecordById(refCollection, refId);
        // item.set("status", "paid");
        // $app.save(item);
    }

    if (status === "CANCELED") { /* ... */ }
    if (status === "EXPIRED")  { /* ... */ }

    if (e.record.getString("refund_status") === "APPROVED") { /* ... */ }

    if (typeof e.next === "function") e.next();
}, "clip_orders");
```

### Para SPEI — `my_app_spei_handler.pb.js`

```js
/// <reference path="../pb_data/types.d.ts" />
onRecordAfterUpdateSuccess((e) => {
    const status        = e.record.getString("status");
    const refCollection = e.record.getString("reference_collection");
    const refId         = e.record.getString("reference_id");

    if (status === "LIQUIDADO") {
        // 👉 Tu lógica aquí (Banxico confirmó la transferencia):
        // const item = $app.findRecordById(refCollection, refId);
        // item.set("status", "paid");
        // $app.save(item);
    }

    if (status === "REJECTED")      { /* rechazo definitivo */ }
    if (status === "MANUAL_REVIEW") { /* requiere revisión admin */ }
    if (status === "EXPIRED")       { /* orden expirada */ }

    if (typeof e.next === "function") e.next();
}, "spei_orders");
```

**Regla de integración:** El plugin actualiza el estado de `clip_orders` / `spei_orders`. Tu handler reacciona y actualiza TU colección. Nunca al revés.

---

## 📋 Migraciones del Plugin (mínimo necesario)

| Archivo | Propósito |
|---|---|
| `1721500000_clip_collections.js` | Crea `clip_orders` y `clip_payments` |
| `1721500001_fix_clip_orders_partial_index.js` | Fix de índice parcial en `clip_orders` |
| `1721500002_add_refund_fields.js` | Campos de reembolso en `clip_orders` |
| `1721500003_spei_collections.js` | Crea `spei_orders`, `spei_settings`, `cep_verifications` |
| `1721500004_spei_banks_data.js` | Catálogo de bancos mexicanos en `spei_banks` |
| `1785454996_updated_cep_verifications.js` | ★ Relación `order` required + cascade en `cep_verifications` |

> Solo estas 6 migraciones son necesarias para tener el plugin funcionando en cualquier proyecto. Las demás son específicas del negocio Dropper.

---

## ⚡ Variables de Entorno

| Variable | Módulo | Descripción |
|---|---|---|
| `CLIP_API_KEY` | CLIP | Token Basic Auth. Acepta `"Basic xxx..."` o solo `"xxx..."` |
| `POCKETBASE_URL` | CLIP Webhook | URL pública de tu instancia para que Clip retorne el webhook |

> SPEI no requiere variables de entorno propias — la CLABE y el banco se configuran en la colección `spei_settings` desde el admin.

---

## 🔒 Patrones de Seguridad del Plugin

### Parámetros vinculados siempre (nunca concatenar strings de usuario)
```js
// ✅
$app.findFirstRecordByFilter("spei_settings", "shop = {:id}", { id: userInput });
// ❌ nunca
$app.findFirstRecordByFilter("spei_settings", "shop = '" + userInput + "'");
```

### El monto siempre viene del servidor
`POST /api/spei/create-order` ignora cualquier `amount` en el body del cliente. El monto se lee del registro referenciado. Para CLIP, activar SECURE MODE configurando `clip_amount_field` en `plugin_settings`.

### Operaciones críticas en transacción
`$app.runInTransaction()` en la creación de órdenes SPEI y CLIP garantiza consistencia ante fallos parciales.

---

## 🔒 Correcciones de Seguridad (post-auditoría)

> Estas correcciones se aplicaron tras una auditoría completa del plugin. No existen en el repositorio GitHub original.

### ★ Nuevo — `plugin_settings_helper.js`

Módulo CommonJS compartido que centraliza la lógica de autorización del plugin. Elimina la dependencia directa a `_superusers` hardcodeada en cada archivo y la reemplaza por un sistema configurable desde el admin UI de PocketBase.

```js
const psh = require(`${__hooks}/plugin_settings_helper.js`);

// ¿Tiene este usuario derechos de admin del plugin?
psh.isPluginAdmin(userId)
// → true si: es superuser (_superusers) O si su ID está en plugin_settings "admin_user_ids"

// Leer cualquier configuración del plugin
psh.getSetting("clip_amount_field", "")
// → devuelve el valor guardado, o "" si no existe
```

**Por qué:** Con el enfoque anterior, para dar acceso a un operador de backoffice había que hacerlo `_superuser` (acceso completo a PocketBase). Ahora basta con agregar su ID a `plugin_settings`.

---

### ★ Nuevo — `1785790000_plugin_settings.js`

Crea la colección `plugin_settings` con **CRUD completamente bloqueado en la API REST** (todos los rules = `null`). Solo accesible desde:
- Código server-side (`$app.findRecordById(...)`)
- El admin UI de PocketBase (sesión de superusuario)

**Registros iniciales creados por la migración:**

| key | value default | Descripción |
|---|---|---|
| `admin_user_ids` | *(vacío)* | IDs separados por coma de usuarios con privilegios de admin del plugin. Ej: `abc123,def456` |
| `clip_amount_field` | *(vacío)* | Nombre del campo en la colección referenciada que contiene el precio. Si se configura, activa SECURE MODE en `clip_create_link`. Ej: `total`, `price`, `amount` |

**Para configurar:** PocketBase Admin UI → Collections → `plugin_settings` → Records.

---

### 🔒 `clip_create_link.pb.js` — Resolución segura de monto

**Problema:** El cliente enviaba el monto y no había validación de que correspondiera al precio real. Un atacante podía pagar $1 por un producto de $1,000.

**Solución — dos modos:**

| Modo | Condición | Comportamiento |
|---|---|---|
| **SECURE** *(recomendado)* | `clip_amount_field` configurado en `plugin_settings` | Lee el monto del campo configurado en el registro referenciado. El cliente no puede alterarlo. |
| **LEGACY** *(default)* | `clip_amount_field` vacío | Acepta `amount` del cliente. Compatible con proyectos existentes. |

```js
// El endpoint loguea siempre el modo activo:
// [CLIP] create-link  amount_source=server  amount=599
// [CLIP] create-link  amount_source=client  amount=599
```

---

### 🔒 `clip_status_check.pb.js` y `spei_status_check.pb.js` — Auth + Ownership

**Problema:** El comentario decía "Requires authentication" pero el código no lo implementaba. Cualquiera podía ver estado, CLABE (18 dígitos), nombre del titular y monto de cualquier orden conociendo solo el `order_id`.

**Solución — modelo de acceso:**
```
¿Tiene auth?       → No  → 401 Unauthorized
¿Es plugin admin?  → Sí  → Puede ver cualquier orden
¿Es dueño?         → Sí  → Solo puede ver sus propias órdenes
                   → No  → 403 Forbidden
```

*Nota: Órdenes de guests (sin campo `user`) son accesibles solo por admins del plugin.*

---

### 🔒 `clip_refund.pb.js` — `isPluginAdmin` en lugar de `_superusers`

**Problema:** Solo superusers podían ejecutar reembolsos. Para dar acceso a un operador de backoffice se tenía que hacer superuser (acceso completo).

**Solución:**
```js
// ANTES — solo superusers
$app.findRecordById("_superusers", info.auth.id); // ← hardcodeado

// AHORA — superusers + usuarios configurados en plugin_settings
if (!psh.isPluginAdmin(info.auth.id)) {
    throw new ForbiddenError("Plugin admin authentication required");
}
```

---

### 🔒 `clip_transactions.pb.js` — Auth en ambas rutas

**Problema:** `GET /api/clip/transaction/{receiptNo}` y `GET /api/clip/transactions` no tenían autenticación. Cualquiera podía consultar datos financieros y abusar del quota del token de Clip.

**Solución:** Ambas rutas requieren `isPluginAdmin`.

---

### 🔒 `spei_validate_cep.pb.js` — Modelo de 3 niveles

**Problema:** Cualquier usuario autenticado podía llamarlo para cualquier orden, potencialmente provocando bloqueo de IP en Banxico por exceso de scraping.

**Solución — 3 niveles de acceso:**

```
Nivel 1: Sin auth         → 401
Nivel 2: Plugin admin     → acceso total (cualquier orden)
Nivel 3: Dueño de orden   → solo puede re-validar la suya propia
          └─ Un usuario con pago pendiente puede forzar la re-validación
             sin esperar al cron de 2 minutos.
```

---

### ⚙️ Rate Limiting — Configurar desde PocketBase UI

No se corrige con código. PocketBase v0.23+ tiene rate limiting nativo.

**Settings → Rate Limiting:**

| Endpoint | Límite sugerido |
|---|---|
| `POST /api/spei/report-payment` | 10 req/min por IP |
| `POST /api/spei/create-order` | 20 req/min por usuario |
| `POST /api/clip/create-link` | 30 req/min por IP |
| `POST /api/spei/validate-cep` | 5 req/min por usuario |

---

*Última actualización: 2026-08-03 — Incluye correcciones de seguridad post-auditoría.*
