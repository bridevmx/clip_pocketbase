# Plan: Plugin SPEI/CEP para PocketBase

> Complemento al plugin Clip para validar pagos con transferencia bancaria SPEI.

## Resumen

Nuevo plugin "copy-paste" que permite a los usuarios reportar pagos SPEI y valida automáticamente contra Banxico. Si la transferencia está "Liquidado" y los datos coinciden, se marca como pagado. Si no, se reintenta automáticamente o se escala a revisión manual.

## Decisiones Tomadas

| Pregunta | Respuesta |
|----------|-----------|
| Unificado vs Separado | **Separado** — `spei_orders` independiente de `clip_orders` |
| Validación automática | **Sí** — al reportar pago, se valida CEP en background |
| Reintentos "En proceso" | **Automático** — cada 5 min por 1 hora, luego MANUAL_REVIEW |
| Múltiples cuentas | **Sí** — `spei_settings` soporta múltiples cuentas beneficiarias |
| Formulario HTML | **iframe** — ruta personalizada que sirve el formulario |

---

## Arquitectura del Plugin

### Estructura de Archivos

```
pb_hooks/
├── spei_00_bootstrap.pb.js          # Mensajes de inicio
├── spei_api_client.js               # CommonJS: validación CEP
├── spei_create_order.pb.js          # POST /api/spei/create-order
├── spei_report_payment.pb.js        # POST /api/spei/report-payment
├── spei_validate_cep.pb.js          # POST /api/spei/validate-cep (interno)
├── spei_status_check.pb.js          # GET /api/spei/order/{id}/status
├── spei_cep_form.pb.js              # GET /api/spei/form (iframe)
├── my_app_spei_handler.pb.js        # Business logic (outside plugin)

pb_migrations/
├── 1721500003_spei_collections.js   # Crea spei_settings, spei_orders, cep_verifications
├── 1721500004_spei_banks_data.js    # Datos semilla de bancos

pb_public/
├── spei-cep-form.html               # Formulario de reporte de pago
```

---

## Colecciones

### 1. `spei_settings` — Configuración de cuentas beneficiarias

Almacena las cuentas bancarias donde se reciben pagos SPEI.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `label` | text | Nombre descriptivo (ej: "Cuenta principal") |
| `clabe` | text | CLABE de 18 dígitos |
| `bank_code` | text | Código del banco (ej: "40012" = BBVA) |
| `bank_name` | text | Nombre del banco |
| `account_holder` | text | Nombre del titular |
| `is_active` | bool | Si esta cuenta está habilitada |
| `created` | autodate | Fecha de creación |
| `updated` | autodate | Fecha de actualización |

**Reglas de acceso:**
- List/View: Solo staff autenticado
- Create/Update/Delete: Solo staff autenticado

### 2. `spei_orders` — Órdenes de pago SPEI

Registra cada intento de pago SPEI.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `reference_collection` | text | Colección del pedido (ej: "products") |
| `reference_id` | text | ID del pedido en esa colección |
| `user` | relation (users) | Usuario que reportó (opcional) |
| `amount` | number | Monto a pagar |
| `currency` | text | Siempre "MXN" |
| `status` | select | Ver estados abajo |
| `spei_settings` | relation | Cuenta beneficiaria destino |
| `criterio` | text | Referencia o clave de rastreo |
| `emisor` | text | Código del banco emisor |
| `emisor_name` | text | Nombre del banco emisor |
| `cuenta_beneficiaria` | text | CLABE destino (snapshot) |
| `monto_declarado` | text | Monto que el usuario dice pagar |
| `submitted_at` | date | Cuando reportó el pago |
| `validated_at` | date | Cuando se validó el CEP |
| `retry_count` | number | Intentos de validación |
| `next_retry_at` | date | Próximo reintento |
| `created` | autodate | |
| `updated` | autodate | |

**Estados (`status`):**
```
PENDING        → Esperando reporte del usuario
REPORTED       → Usuario reportó, validando
LIQUIDADO      → CEP confirmado, pago válido
REJECTED       → CEP no coincide o no encontrado
MANUAL_REVIEW  → Requiere intervención humana
EXPIRED        → Tiempo de validación agotado
```

**Flujo de estados:**
```
PENDING ──report──→ REPORTED ──validar──→ LIQUIDADO (match exacto)
                              │
                              ├──→ REJECTED (no coincide)
                              │
                              └──→ PENDING (en proceso, reintentar)
                                    │
                                    └──→ MANUAL_REVIEW (después de 12 intentos)
                                          │
                                          └──→ EXPIRED (después de 24h)
```

**Reglas de acceso:**
- List/View: Solo staff autenticado
- Create: Público (usuario reporta pago)
- Update: Solo staff autenticado (cambiar estado manualmente)
- Delete: Solo staff autenticado

### 3. `cep_verifications` — Audit trail de validaciones CEP

Almacena cada intento de validación CEP.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `order` | relation | Link a spei_orders |
| `reference` | text | Número de referencia del CEP |
| `tracking_code` | text | Clave de rastreo |
| `issuing_bank` | text | Banco emisor (respuesta CEP) |
| `receiving_bank` | text | Banco receptor (respuesta CEP) |
| `status_name` | text | Estado del CEP (Liquidado, En proceso, etc.) |
| `status_description` | text | Descripción del estado |
| `reception_date` | text | Fecha/hora de recepción |
| `processing_date` | text | Fecha/hora de procesamiento |
| `beneficiary_account` | text | Cuenta beneficiaria (respuesta CEP) |
| `amount` | number | Monto del CEP |
| `validated_match` | bool | ¿Coincidió con lo declarado? |
| `mismatch_reason` | text | Razón del mismatch |
| `raw_response` | json | Respuesta completa del CEP |
| `validated_by` | relation (users) | null = automático, user_id = manual |
| `created` | autodate | |
| `updated` | autodate | |

**Reglas de acceso:**
- List/View: Solo staff autenticado
- Create/Update/Delete: false (solo hooks)

### 4. `spei_banks` — Catálogo de bancos

Lista de bancos para los selects del formulario.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `bank_code` | text | Código Banxico (ej: "40012") |
| `bank_name` | text | Nombre del banco |
| `is_active` | bool | Si aparece en el formulario |
| `created` | autodate | |
| `updated` | autodate | |

**Reglas de acceso:**
- List: Público (para poblar selects)
- View/Create/Update/Delete: Solo staff autenticado

---

## Hooks y Rutas

### 1. `spei_create_order.pb.js`

```
POST /api/spei/create-order
```

**Request:**
```json
{
  "amount": 100.00,
  "reference_collection": "products",
  "reference_id": "PROD_001",
  "spei_settings_id": "abc123"
}
```

**Response (200):**
```json
{
  "order_id": "xyz789",
  "status": "PENDING",
  "spei_settings": {
    "clabe": "123456789012345678",
    "bank_name": "BBVA MEXICO",
    "account_holder": "Mi Negocio"
  }
}
```

**Lógica:**
1. Validar datos de entrada
2. Buscar `spei_settings` por ID
3. Crear `spei_orders` con status PENDING
4. Retornar datos de la cuenta para que el usuario haga la transferencia

### 2. `spei_report_payment.pb.js`

```
POST /api/spei/report-payment
```

**Request:**
```json
{
  "order_id": "xyz789",
  "criterio": "1234567",
  "emisor": "40012",
  "monto_declarado": 100.00
}
```

**Response (200):**
```json
{
  "ok": true,
  "status": "REPORTED",
  "message": "Pago reportado. Validando automáticamente..."
}
```

**Lógica:**
1. Buscar `spei_orders` por ID
2. Validar que status sea PENDING
3. Actualizar campos: criterio, emisor, monto_declarado, submitted_at
4. Cambiar status a REPORTED
5. **Trigger validación CEP en background** (ver hook 3)

### 3. `spei_validate_cep.pb.js`

```
POST /api/spei/validate-cep  (interno, no público)
```

**Request:**
```json
{
  "order_id": "xyz789"
}
```

**Lógica:**
1. Buscar `spei_orders` por ID
2. Obtener datos: criterio, emisor, receptor (de spei_settings), cuenta, monto
3. Formatear fecha (DD-MM-YYYY)
4. Lamar a Banxico CEP API (scraping)
5. Crear registro en `cep_verifications`
6. Evaluar resultado:

| CEP Status | Coincidencia | Acción |
|------------|--------------|--------|
| Liquidado | amount + account = match | → LIQUIDADO |
| Liquidado | amount o account ≠ match | → REJECTED |
| En proceso | — | → PENDING (reprogramar retry) |
| Cancelado/Rechazado | — | → REJECTED |
| No encontrado | — | → PENDING (reprogramar retry) |

7. Si es "En proceso" y retry_count < 12:
   - Incrementar retry_count
   - Calcular next_retry_at (5 min intervals)
   - No cambiar status (queda PENDING)

8. Si retry_count >= 12:
   - Cambiar status a MANUAL_REVIEW

### 4. `spei_status_check.pb.js`

```
GET /api/spei/order/{id}/status
```

**Response (200):**
```json
{
  "order_id": "xyz789",
  "status": "LIQUIDADO",
  "last_validation": {
    "status_name": "Liquidado",
    "validated_at": "2026-07-21T19:00:00Z",
    "validated_match": true
  }
}
```

### 5. `spei_cep_form.pb.js`

```
GET /api/spei/form
```

**Response:** HTML con iframe que carga `/spei-cep-form.html`

El HTML se sirve desde `pb_public/spei-cep-form.html`.

---

## API Client: `spei_api_client.js`

```javascript
// Funciones exportadas:

/**
 * Valida un CEP contra Banxico
 * @param {string} fecha - DD-MM-YYYY
 * @param {string} criterio - Referencia (7 chars) o clave rastreo (8-30 chars)
 * @param {string} emisor - Código banco emisor
 * @param {string} receptor - Código banco receptor
 * @param {string} cuenta - CLABE beneficiaria
 * @param {string} monto - Monto
 * @returns {{ data: object, statusCode: number }}
 */
function validar(fecha, criterio, emisor, receptor, cuenta, monto) { ... }

/**
 * Parsea el HTML de respuesta del CEP
 * @param {string} html - HTML crudo de Banxico
 * @returns {object} - Datos parseados
 */
function parseCepResponse(html) { ... }

/**
 * Detecta tipo de criterio
 * @param {string} criterio
 * @returns {"R"|"T"} - R=folio, T=clave rastreo
 */
function detectCriterioType(criterio) { ... }
```

---

## Migraciones

### 1721500003_spei_collections.js

Crea las 4 colecciones:
- `spei_settings`
- `spei_orders`
- `cep_verifications`
- `spei_banks`

### 1721500004_spei_banks_data.js

Inserta los ~100 bancos del catálogo Banxico.

---

## Flujo de Datos Completo

### Flujo Tarjeta (Clip) — ya implementado
```
1. Usuario crea pedido → POST /api/clip/create-link
2. Clip genera link → payment_url
3. Usuario paga con tarjeta
4. Clip envía webhook → POST /api/clip/webhook
5. Plugin valida con Clip API → status COMPLETED
6. Handler ejecuta business logic
```

### Flujo SPEI — nuevo plugin
```
1. Usuario crea pedido → POST /api/spei/create-order
2. Plugin retorna datos de cuenta → CLABE, banco, titular
3. Usuario hace transferencia desde su banco
4. Usuario reporta pago → POST /api/spei/report-payment
5. Plugin valida CEP automáticamente → status LIQUIDADO
6. Handler ejecuta business logic
```

---

## Business Logic Handler

Archivo separado `my_app_spei_handler.pb.js` (outside plugin):

```javascript
onRecordAfterUpdateSuccess((e) => {
    const status = e.record.getString("status");
    
    if (status === "LIQUIDADO") {
        // Activar producto/servicio
        // Enviar email de confirmación
        // etc.
    }
    
    if (status === "REJECTED") {
        // Notificar al usuario
        // etc.
    }
    
    e.next();
}, "spei_orders");
```

---

## Próximos Pasos

1. **Crear migraciones** — spei_collections.js, spei_banks_data.js
2. **Crear API client** — spei_api_client.js
3. **Crear hooks** — spei_create_order, spei_report_payment, spei_validate_cep
4. **Crear formulario HTML** — spei-cep-form.html
5. **Crear handler de ejemplo** — my_app_spei_handler.pb.js
6. **Tests E2E** — script test-spei.js
7. **Documentación** — README actualizado
