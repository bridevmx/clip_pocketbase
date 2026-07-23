# ADR 0005: SPEI/CEP Plugin — Security Validations

**Fecha:** 2026-07-22
**Estado:** Aprobado
**Decisor:** Equipo de desarrollo

---

## Problem Statement

El plugin SPEI/CEP permite a usuarios reportar pagos de transferencias bancarias y validarlos contra Banxico. Sin embargo, existen múltiples vectores de fraude potencial:

1. **CEP reutilizado** — Un mismo comprobante de pago puede reportarse para múltiples órdenes
2. **CEP de fecha pasada** — Una transferencia antigua puede hacerse pasar como nueva
3. **Monto incorrecto** — El usuario puede declarar un monto diferente al real
4. **Orden expirada** — Reportar pagos para órdenes que ya expiraron

---

## Solution

Se implementaron 4 validaciones de seguridad en el flujo de reporte de pago:

### 1. Expiración de orden (24h)

La orden debe ser reportada dentro de las 24 horas posteriores a su creación.

```javascript
var diffHours = (now - created) / (1000 * 60 * 60);
if (diffHours > 24) {
  throw new BadRequestError("Order has expired");
}
```

**Razón:** Las órdenes SPEI tienen una ventana de 24h para ser pagadas. Después de eso, la orden debe expirar.

### 2. Validación de monto declarado

El monto declarado debe ser >= el monto de la orden (con 10% de tolerancia por comisiones bancarias).

```javascript
if (declared < orderAmount) {
  throw new BadRequestError("Declared amount is less than order amount");
}
if (declared > orderAmount * 1.1) {
  throw new BadRequestError("Declared amount exceeds order amount");
}
```

**Razón:** Evita que el usuario declare un monto menor al que debe pagar (infrapago) o mayor (sobrepago no autorizado).

### 3. Prevención de reuso de CEP

No se permite reportar el mismo tracking code + amount en más de una orden.

```javascript
var existingCep = $app.findRecordsByFilter(
  "cep_verifications",
  `tracking_code="${criterio}" && amount=${declared}`,
  "", 1, 0
);
if (existingCep.length > 0) {
  throw new BadRequestError("This payment has already been reported");
}
```

**Razón:** Un solo pago no debe activar múltiples órdenes (doble gasto).

### 4. Detección de CEP desactualizado

El CEP debe haber sido procesado dentro de las últimas 24 horas.

```javascript
var diffHours = (now - cepDate) / (1000 * 60 * 60);
if (diffHours > 24) {
  return { isMatch: false, newStatus: "REJECTED", reason: "CEP too old" };
}
```

**Razón:** Un CEP de una transferencia antigua no debe hacerse pasar como un pago nuevo.

---

## Security Analysis

Se identificaron 10 vulnerabilidades en total. Este ADR cubre las 4 críticas. Las 6 restantes están documentadas en `docs/SECURITY-spei-analysis.md` para implementación futura.

| # | Severidad | Vulnerabilidad | Este ADR |
|---|-----------|---------------|----------|
| 1 | 🔴 CRÍTICO | CEP desactualizado (stale) | ✅ Cubierto |
| 2 | 🔴 CRÍTICO | Reuso de CEP en múltiples órdenes | ✅ Cubierto |
| 3 | 🟠 ALTO | Monto declarado incorrecto | ✅ Cubierto |
| 4 | 🟠 ALTO | Sin límite de tiempo para reportar | ✅ Cubierto |
| 5 | 🟡 MEDIO | Monto declarado > monto de orden | ✅ Cubierto |
| 6-10 | 🟡/🟢 | Ver `SECURITY-spei-analysis.md` | 📋 Futuro |

---

## File Changes

| Archivo | Cambio |
|---------|--------|
| `pb_hooks/spei_report_payment.pb.js` | Agregar 3 validaciones pre-CEP |
| `pb_hooks/spei_api_client.js` | Agregar `parseCepDate()` + validación de fecha en `evaluateCepResult` |
| `docs/SECURITY-spei-analysis.md` | Nuevo — análisis completo de seguridad |

---

## Consequences

**Positivas:**
- Previene fraude de doble gasto
- Previene reuso de comprobantes antiguos
- Garantiza montos correctos
- Límite temporal claro

**Negativas:**
- Usuarios legítimos con transferencias lentas (+24h) no podrán reportar
- Tolerancia del 10% podría permitir small fraud en montos altos
- Sin límite de reintentos por IP (futuro)

---

## Referencias

- `docs/SECURITY-spei-analysis.md` — Análisis detallado de las 10 vulnerabilidades
- `docs/PLAN-spei-cep-plugin.md` — Plan del plugin
