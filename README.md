# 🇲🇽 PocketBase Clip México

> Plugin de pagos para [PocketBase](https://pocketbase.io) que integra **Clip México Checkout API** — links de pago, webhooks y registro de auditoría — sin modificar tu código existente.

[![PocketBase](https://img.shields.io/badge/PocketBase-v0.23%2B-blue?logo=pocketbase)](https://pocketbase.io)
[![Clip México](https://img.shields.io/badge/Clip%20M%C3%A9xico-Checkout%20API-v2-orange)](https://developer.clip.mx/docs/api-de-checkout)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## ✨ ¿Qué hace este plugin?

| Característica | Descripción |
|---|---|
| 🔗 **Links de pago** | `POST /api/clip/create-link` genera un link de pago en Clip y guarda la orden en `clip_orders` |
| 🪝 **Webhook automático** | `POST /api/clip/webhook` recibe la notificación de Clip, verifica el estado real y actualiza la orden |
| 🗂️ **Migraciones automáticas** | Crea las colecciones `clip_orders` y `clip_payments` al iniciar — sin pasos manuales |
| 🔌 **Punto de extensión** | Dispara `onRecordAfterUpdateSuccess` en `clip_orders` para que tu código reaccione a eventos de pago |
| 👤 **Checkout sin registro** | La autenticación es opcional — puedes crear órdenes sin usuario logueado |
| 🔁 **Reintentos automáticos** | Retorna HTTP 502 si Clip no está disponible para que reintente el webhook |

> **Filosofía de diseño:** Este plugin es intencionalmente ciego a tu dominio de negocio. No activa productos, no envía emails, no sabe qué es un "producto". Tú conectas esa lógica en `my_app_clip_handler.pb.js`.

---

## 📋 Requisitos

| Requisito | Versión mínima | Notas |
|---|---|---|
| 🟣 **PocketBase** | v0.23+ | Usa `Buffer.from()` para Base64 — [confirmado disponible](https://github.com/pocketbase/pocketbase/discussions/6651) |
| 💳 **Cuenta de Clip México** | — | Necesitas una [cuenta de desarrollador](https://developer.clip.mx) con llave de Checkout API |

---

## 🚀 Instalación paso a paso

### Paso 1: Descarga los archivos

Descarga o copia estos archivos en tu proyecto de PocketBase:

```
tu-proyecto-pocketbase/
├── pb_hooks/
│   ├── clip_00_bootstrap.pb.js        ← Mensajes de inicio
│   ├── clip_api_client.js             ← Cliente HTTP para Clip API
│   ├── clip_create_link.pb.js         ← Ruta: crear link de pago
│   ├── clip_webhook.pb.js             ← Ruta: recibir webhook
│   └── my_app_clip_handler.pb.js      ← Tu lógica de negocio (editable)
└── pb_migrations/
    └── 1721500000_clip_collections.js  ← Crea las colecciones automáticamente
```

> 💡 **¿Solo copiar y pegar?** Sí. No necesitas instalar npm packages, Docker, ni configuraciones complejas.

---

### Paso 2: Configura las variables de entorno

Necesitas **2 variables** para que el plugin funcione:

| Variable | ¿Qué es? | Ejemplo |
|---|---|---|
| `CLIP_API_KEY` | Tu token de Clip México (formato Base64) | `NjQyZmYxZmMtMjUzMi00...` |
| `POCKETBASE_URL` | URL pública de tu instancia PocketBase | `https://mi-app.pockethost.io` |

#### 🔑 ¿Cómo obtener tu CLIP_API_KEY?

1. Ve a [developer.clip.mx](https://developer.clip.mx)
2. Inicia sesión con tu cuenta
3. Copia el token que aparece en el generador de tokens
4. Copia **todo** el string incluyendo el prefijo `Basic `

> ⚠️ **Nunca guardes estas llaves en archivos de código**. Son credenciales sensibles — guárdalas exclusivamente en tu entorno de despliegue.

#### 📍 Configuración por plataforma

<details>
<summary>🟣 <strong>PocketHost</strong> (hosting gratuito)</summary>

1. Ve al dashboard de tu instancia
2. Haz clic en la pestaña **Secrets**
3. Agrega las dos variables:

```
CLIP_API_KEY=tu_token_de_clip_aqui
POCKETBASE_URL=https://tu-instancia.pockethost.io
```

</details>

<details>
<summary>🔵 <strong>Easypanel</strong></summary>

1. Ve a tu App Service
2. Haz clic en la pestaña **Environment**
3. Agrega las dos variables:

```
CLIP_API_KEY=tu_token_de_clip_aqui
POCKETBASE_URL=https://pb.tuapp.com
```

</details>

<details>
<summary>🐳 <strong>Docker Compose</strong></summary>

```yaml
services:
  pocketbase:
    image: tu-imagen-de-pocketbase
    environment:
      CLIP_API_KEY: tu_token_de_clip_aqui
      POCKETBASE_URL: https://pb.tuapp.com
    volumes:
      - ./pb_data:/pb_data
```

</details>

<details>
<summary>🖥️ <strong>Desarrollo local</strong></summary>

```bash
CLIP_API_KEY=tu_token_de_clip_aqui POCKETBASE_URL=http://localhost:8090 ./pocketbase serve
```

</details>

---

### Paso 3: Reinicia PocketBase

Las migraciones se ejecutan automáticamente al iniciar. Verás esto en la consola:

```
[CLIP PLUGIN] ─────────────────────────────────────────
[CLIP PLUGIN] Loaded successfully.
[CLIP PLUGIN] Expected collections: clip_orders, clip_payments
[CLIP PLUGIN] Active routes: POST /api/clip/create-link, POST /api/clip/webhook
[CLIP PLUGIN] To add your business logic after payment, create/edit:
[CLIP PLUGIN]   -> pb_hooks/my_app_clip_handler.pb.js
[CLIP PLUGIN] ─────────────────────────────────────────
```

✅ Si ves este mensaje, ¡el plugin está instalado correctamente!

---

## 🔌 Conecta tu lógica de negocio

Después de que un pago cambie de estado, PocketBase ejecuta `onRecordAfterUpdateSuccess` en la colección `clip_orders`. Edita `pb_hooks/my_app_clip_handler.pb.js` para reaccionar:

```js
/// <reference path="../pb_data/types.d.ts" />

onRecordAfterUpdateSuccess((e) => {
    const status = e.record.getString("status");

    if (status === "COMPLETED") {
        const refCollection = e.record.getString("reference_collection"); // ej: "productos"
        const refId         = e.record.getString("reference_id");         // ej: "abc123"
        const userId        = e.record.getString("user");                 // vacío para guest
        const receiptNo     = e.record.getString("receipt_no");
        const amountPaid    = e.record.get("amount_paid");

        // 👉 Tu lógica aquí:
        //   - activar un producto o suscripción
        //   - enviar email de confirmación
        //   - desbloquear un curso o viaje
        //   - actualizar inventario

        $app.logger().info("Pago completado",
            "ref_collection", refCollection,
            "ref_id", refId,
            "receipt", receiptNo
        );
    }

    e.next();
}, "clip_orders");
```

> 💡 El plugin imprime un recordatorio en la consola cada vez que PocketBase se reinicia para que nunca olvides dónde está tu lógica.

---

## 💳 Crear un link de pago

Llama a `POST /api/clip/create-link` desde tu frontend o backend. El usuario puede estar autenticado **o** puedes crear órdenes como guest.

### Request con usuario logueado

```http
POST /api/clip/create-link
Authorization: Bearer <user-token>
Content-Type: application/json

{
  "amount": 299.00,
  "reference_collection": "productos",
  "reference_id": "PROD_ABC123"
}
```

### Request sin usuario (guest checkout)

```http
POST /api/clip/create-link
Content-Type: application/json

{
  "amount": 299.00,
  "reference_collection": "productos",
  "reference_id": "PROD_ABC123"
}
```

### Response

```json
{
  "order_id": "abc123def456",
  "payment_url": "https://pago.clip.mx/v3/uuid-del-pago",
  "payment_request_id": "uuid-del-pago",
  "status": "CREATED"
}
```

**Redirige al usuario a `payment_url`** — Clip maneja la página de pago.

---

## 💸 Reembolsar un pago

Llama a `POST /api/clip/refund` con superuser auth. El pago debe estar en status `COMPLETED`.

### Request (reembolso parcial)

```http
POST /api/clip/refund
Authorization: Bearer <superuser-token>
Content-Type: application/json

{
  "order_id": "abc123def456",
  "amount": 100.00,
  "reason": "Customer returned product"
}
```

### Request (reembolso total)

```http
POST /api/clip/refund
Authorization: Bearer <superuser-token>
Content-Type: application/json

{
  "order_id": "abc123def456"
}
```

### Response

```json
{
  "success": true,
  "refund_id": "uuid-del-reembolso",
  "receipt_no": "RfXyZ123",
  "status": "APPROVED",
  "amount_refunded": 100.00
}
```

> ⚠️ **Requiere superuser auth.** Los reembolsos solo funcionan para pagos con tarjeta y dentro de 180 días.

---

## 📊 Consultar transacciones

### Por número de recibo

```http
GET /api/clip/transaction/{receipt_no}
Authorization: Bearer <user-token>
```

### Por rango de fechas

```http
GET /api/clip/transactions?from=2026-07-01&to=2026-07-21
Authorization: Bearer <user-token>
```

**Parámetros opcionales:**
- `page` — Número de página (default: 1)
- `per_page` — Registros por página (default: 50)

> 📌 **Límite:** Rango máximo de 30 días consecutivos.

---

## 🔍 Verificar estado de orden

Verifica el estado de una orden consultando Clip API directamente — útil cuando el webhook no llega.

```http
GET /api/clip/order/{order_id}/status
Authorization: Bearer <user-token>
```

### Response

```json
{
  "order_id": "abc123def456",
  "clip_status": "COMPLETED",
  "receipt_no": "PuGCZDqV",
  "amount_paid": 1.00,
  "last_checked": "2026-07-21T18:00:00Z"
}
```

> 💡 **Tip:** Este endpoint actualiza la orden si el status cambió desde la última verificación.

---

## 🔄 Flujo de pago completo

```
Tu App                     PocketBase                       Clip API
   │                            │                               │
   │  POST /api/clip/           │                               │
   │    create-link ───────────►│                               │
   │                            │── POST /v2/checkout ─────────►│
   │                            │◄── { payment_url } ──────────│
   │◄── { payment_url } ────────│                               │
   │                            │                               │
   │  Redirigir usuario a ──────┼───────────────────────────────► Página de Clip
   │  payment_url               │                               │
   │                            │                               │
   │                            │◄── POST /api/clip/webhook ────│  (usuario paga)
   │                            │── GET /v2/checkout/{id} ─────►│  (verifica estado)
   │                            │◄── { status: COMPLETED } ─────│
   │                            │                               │
   │                            │  Actualiza clip_orders.status │
   │                            │  Dispara onRecordAfterUpdate  │
   │                            │  → my_app_clip_handler.pb.js  │
```

> 🔐 **Nota de seguridad:** El webhook de Clip solo contiene un ID, no el estado del pago. El plugin **siempre** consulta `GET /v2/checkout/{id}` antes de confiar en cualquier cambio de estado — la respuesta de la API es siempre la fuente de verdad.

---

## 🗂️ Referencia de colecciones

### `clip_orders` — Órdenes de pago

Una registro por cada intento de pago.

| Campo | Tipo | Descripción |
|---|---|---|
| `reference_collection` | `text` | Nombre de tu colección (ej: `productos`, `viajes`, `cursos`) |
| `reference_id` | `text` | ID del registro que se está pagando en esa colección |
| `user` | `relation` | Usuario de PocketBase — **vacío para guest checkout** |
| `amount` | `number` | Monto solicitado en MXN |
| `currency` | `text` | Siempre `MXN` |
| `status` | `select` | Ver [ciclo de vida del estado](#-ciclo-de-vida-del-estado) |
| `clip_payment_request_id` | `text` | ID único de Clip (índice único) |
| `clip_payment_url` | `url` | URL para que el usuario pague |
| `clip_raw_status` | `text` | Estado crudo de Clip (auditoría) |
| `receipt_no` | `text` | Número de recibo de Clip — se llena en `COMPLETED` |
| `amount_paid` | `number` | Monto confirmado por Clip — se llena en `COMPLETED` |
| `paid_at` | `date` | Fecha/hora del pago exitoso |
| `canceled_at` | `date` | Fecha/hora de cancelación o expiración |
| `created` | `autodate` | Se establece al crear el registro |
| `updated` | `autodate` | Se actualiza en cada guardado |

### `clip_payments` — Registro de auditoría

Registro inmutable. Un registro por cada evento de webhook recibido.

| Campo | Tipo | Descripción |
|---|---|---|
| `order` | `relation` | La orden `clip_orders` a la que pertenece este evento |
| `raw_webhook_payload` | `json` | El payload exacto recibido de Clip |
| `raw_api_response` | `json` | La respuesta completa de `GET /v2/checkout/{id}` |
| `received_at` | `date` | Cuándo llegó el webhook |
| `created` | `autodate` | Se establece al crear el registro |
| `updated` | `autodate` | Se actualiza en cada guardado |

---

## 📊 Ciclo de vida del estado

```
PENDING_LINK  →  CREATED  →  PENDING  →  COMPLETED
                                       ↘  CANCELED
                                       ↘  EXPIRED
ERROR_CLIP  (Error al crear el link)
```

| Estado | Significado |
|---|---|
| `PENDING_LINK` | Orden creada localmente, llamada a Clip API pendiente |
| `CREATED` | ✅ Link de pago generado, esperando al usuario |
| `PENDING` | 🔄 Usuario inició el proceso de pago en Clip |
| `COMPLETED` | ✅ Pago confirmado — ejecuta tu lógica de negocio |
| `CANCELED` | ❌ Usuario canceló o pago fue rechazado |
| `EXPIRED` | ⏱️ El link expiró antes de que el usuario completara el pago |
| `ERROR_CLIP` | ⚠️ Clip API retornó error al crear el link |

---

## 📁 Referencia de archivos del plugin

| Archivo | Propósito | ¿Editable? |
|---|---|---|
| `clip_00_bootstrap.pb.js` | Mensajes de consola al iniciar | ❌ No |
| `clip_api_client.js` | Cliente HTTP centralizado para Clip API | ❌ No |
| `clip_create_link.pb.js` | Ruta: `POST /api/clip/create-link` | ❌ No |
| `clip_webhook.pb.js` | Ruta: `POST /api/clip/webhook` | ❌ No |
| `clip_refund.pb.js` | Ruta: `POST /api/clip/refund` | ❌ No |
| `clip_transactions.pb.js` | Rutas: `GET /api/clip/transaction/{receipt}` y `GET /api/clip/transactions` | ❌ No |
| `clip_status_check.pb.js` | Ruta: `GET /api/clip/order/{id}/status` | ❌ No |
| `my_app_clip_handler.pb.js` | Tu lógica de negocio después del pago | ✅ **Sí — este es tuyo** |
| `pb_migrations/1721500000_clip_collections.js` | Crea `clip_orders` y `clip_payments` | ❌ No |
| `pb_migrations/1721500002_add_refund_fields.js` | Agrega campos de reembolso a `clip_orders` | ❌ No |

---

## ⚠️ Notas importantes

### 🚫 Clip no tiene sandbox
Todas las llamadas a la API son **producción real**. Para probar, usa cargos de **$1.00 MXN** y reembolsa inmediatamente desde el dashboard de Clip.

### 🔒 Seguridad del webhook
Clip no expone una firma HMAC verificable en los payloads del webhook. El plugin mitiga esto siempre re-consultando la API de Clip antes de confiar en cualquier cambio de estado.

### 🔁 Reintentos del webhook
Si la API de Clip no está disponible cuando llega el webhook, el plugin responde con **HTTP 502** para que Clip reintente el envío automáticamente.

### 🌐 POCKETBASE_URL debe ser pública
La URL de tu instancia PocketBase debe ser accesible públicamente por los servidores de Clip. `localhost` no funcionará para el webhook en producción.

### 💡 Detección de pagos sin webhook
El plugin también detecta pagos completados cuando el usuario regresa al link de pago. Esto funciona como respaldo si el webhook no llega.

---

## 🛠️ Solución de problemas

### ❌ "Could not create Clip payment link"
**Causa:** La API de Clip rechazó la solicitud.
**Solución:** Verifica que tu `CLIP_API_KEY` sea correcto y que el monto sea válido ($1 - $99,999 MXN).

### ❌ El webhook no llega
**Causa:** PocketBase está hibernando (en PocketHost, la instancia se duerme después de 30s sin actividad).
**Solución:** El plugin detecta el pago cuando el usuario regresa al link. No es crítico, pero el webhook es más confiable para activaciones automáticas.

### ❌ "too many open files" en los logs
**Causa:** PocketHost tiene un límite de archivos abiertos.
**Solución:** No afecta la funcionalidad. Es un warning del sistema de archivos.

---

# 🏦 Plugin SPEI/CEP — Transferencias Bancarias

> Plugin complementario para verificar pagos SPEI/CEP vía Banxico.

## ✨ ¿Qué hace este plugin?

| Característica | Descripción |
|---|---|
| 💰 **Crear orden SPEI** | `POST /api/spei/create-order` genera una orden con datos de beneficiario |
| 📤 **Reportar pago** | `POST /api/spei/report-payment` registra transferencia y valida CEP automáticamente |
| 🔍 **Validar CEP** | `POST /api/spei/validate-cep` re-intenta validación (staff only) |
| 🔄 **Reintentos automáticos** | Reintenta cada 5 min hasta 12 veces, luego escala a revisión manual |
| 🏦 **Catálogo de bancos** | ~100 bancos mexicanos en `spei_banks` |

## 🚀 Instalación

Los archivos del plugin SPEI se copian junto con los de Clip:

```
tu-proyecto-pocketbase/
├── pb_hooks/
│   ├── spei_api_client.js           ← Cliente CEP (CommonJS)
│   ├── spei_00_bootstrap.pb.js      ← Verificación de colecciones
│   ├── spei_create_order.pb.js      ← POST /api/spei/create-order
│   ├── spei_report_payment.pb.js    ← POST /api/spei/report-payment
│   ├── spei_validate_cep.pb.js      ← POST /api/spei/validate-cep
│   ├── spei_status_check.pb.js      ← GET /api/spei/order/{id}/status
│   ├── spei_cep_form.pb.js          ← GET /api/spei/form
│   └── my_app_spei_handler.pb.js    ← Tu lógica de negocio
├── pb_migrations/
│   ├── 1721500003_spei_collections.js
│   └── 1721500004_spei_banks_data.js
└── pb_public/
    └── spei-cep-form.html           ← Formulario de reporte
```

## 🔌 API Reference

### Crear orden SPEI

```http
POST /api/spei/create-order
Content-Type: application/json

{
  "amount": 1500.00,
  "reference_collection": "orders",
  "reference_id": "ORD_123",
  "concept": "Pago de servicio"
}
```

### Reportar pago

```http
POST /api/spei/report-payment
Content-Type: application/json

{
  "order_id": "spei_order_id",
  "criterio": "ABC1234",
  "emisor": "40012",
  "monto_declarado": 1500.00
}
```

### Validar CEP (staff only)

```http
POST /api/spei/validate-cep
Authorization: Bearer <user-token>
Content-Type: application/json

{
  "order_id": "spei_order_id"
}
```

### Consultar estado

```http
GET /api/spei/order/{order_id}/status
```

## 🔄 Flujo SPEI

```
Tu App                     PocketBase                       Banxico
   │                            │                               │
   │  POST /api/spei/           │                               │
   │    create-order ──────────►│                               │
   │◄── { order_id, spei_url }──│                               │
   │                            │                               │
   │  Usuario realiza           │                               │
   │  transferencia SPEI ───────┼───────────────────────────────►
   │                            │                               │
   │  POST /api/spei/           │                               │
   │    report-payment ────────►│                               │
   │                            │── GET /cep ───────────────────►│
   │                            │◄── CEP HTML ─────────────────│
   │                            │                               │
   │                            │  Valida: monto, cuenta, banco │
   │                            │  Si match → LIQUIDADO         │
   │                            │  Si no → retry cada 5 min     │
   │                            │  Max 12 → MANUAL_REVIEW       │
```

## 📊 Estados SPEI

| Estado | Significado |
|---|---|
| `PENDING` | Orden creada, esperando transferencia |
| `REPORTED` | Pago reportado, validación en curso |
| `LIQUIDADO` | ✅ CEP validado, pago confirmado |
| `MANUAL_REVIEW` | ⚠️ Requiere revisión manual |
| `EXPIRED` | ⏱️ Timeout después de 24h |
| `REJECTED` | ❌ CEP no encontrado o datos no coinciden |

## 📁 Colecciones

### `spei_orders` — Órdenes de transferencia

| Campo | Tipo | Descripción |
|---|---|---|
| `reference_collection` | `text` | Tu colección de referencia |
| `reference_id` | `text` | ID de tu registro |
| `user` | `relation` | Usuario PocketBase (opcional) |
| `amount` | `number` | Monto en MXN |
| `status` | `select` | Estado de la orden |
| `criterio` | `text` | Referencia de la transferencia |
| `emisor` | `text` | Banco emisor (código) |
| `monto_declarado` | `text` | Monto declarado |

### `spei_banks` — Catálogo de bancos

| Campo | Tipo | Descripción |
|---|---|---|
| `bank_code` | `text` | Código Banxico (ej: "40012") |
| `bank_name` | `text` | Nombre completo |
| `is_active` | `bool` | Banco activo |

---

## 🔒 Seguridad SPEI

El plugin implementa **5 validaciones de seguridad** en `POST /api/spei/report-payment` para prevenir fraude:

| # | Validación | ¿Qué previene? |
|---|------------|----------------|
| 1 | **Expiración de orden** (> 24h desde created) | Reportar pagos en órdenes vencidas |
| 2 | **Monto declarado >= monto orden** | Infrapago deliberado |
| 3 | **Monto declarado <= monto orden × 1.1** | Sobrepago no autorizado |
| 4 | **Tracking code + amount único** | Reutilizar el mismo CEP en múltiples órdenes |
| 5 | **CEP < 24h de antigüedad** | Usar comprobantes de transferencias antiguas |

### Análisis de vulnerabilidades

Para un análisis completo de los 10 vectores de ataque identificados y su estado, ver:
- `docs/SECURITY-spei-analysis.md` — Análisis detallado
- `docs/adr/0005-spei-security-validations.md` — Decisiones arquitectónicas de seguridad

---

## 📄 Licencia

MIT — úsalo libremente en tus propios proyectos.
