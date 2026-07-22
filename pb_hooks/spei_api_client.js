/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// SPEI CEP API client — CommonJS module, shared via require().
//
// Usage in any pb_hooks/*.pb.js file:
//   const spei = require(`${__hooks}/spei_api_client.js`);
//   const result = spei.validate(fecha, criterio, emisor, receptor, cuenta, monto);
//
// This module scrapes Banxico's CEP validation page.
// Banxico does not provide a public API, so we parse the HTML response.
//
// NOTE: This file does NOT use the .pb.js extension — PocketBase only
// auto-executes *.pb.js files as hooks. This file is loaded explicitly
// via require() to share scope correctly across hooks.
// ─────────────────────────────────────────────────────────────────────────

var CEP_ORIGIN = "https://www.banxico.org.mx";
var CEP_HOME_URL = CEP_ORIGIN + "/cep/";
var CEP_VALIDA_URL = CEP_ORIGIN + "/cep/valida.do";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

// ─── HELPERS ──────────────────────────────────────────────────────────────

function safeTrim(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function stripAccents(s) {
  return s
    .replace(/á/g, "a").replace(/é/g, "e").replace(/í/g, "i")
    .replace(/ó/g, "o").replace(/ú/g, "u").replace(/ñ/g, "n")
    .replace(/Á/g, "A").replace(/É/g, "E").replace(/Í/g, "I")
    .replace(/Ó/g, "O").replace(/Ú/g, "U").replace(/Ñ/g, "N");
}

function decodeEntities(s) {
  return s
    .replace(/&aacute;/g, "a").replace(/&eacute;/g, "e")
    .replace(/&iacute;/g, "i").replace(/&oacute;/g, "o")
    .replace(/&uacute;/g, "u").replace(/&ntilde;/g, "n")
    .replace(/&Aacute;/g, "A").replace(/&Eacute;/g, "E")
    .replace(/&Iacute;/g, "I").replace(/&Oacute;/g, "O")
    .replace(/&Uacute;/g, "U").replace(/&Ntilde;/g, "N")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&reg;/g, "")
    .replace(/&euml;/g, "e").replace(/&uuml;/g, "u");
}

function cleanHtml(s) {
  return safeTrim(
    decodeEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "))
  );
}

/**
 * Formats a Date object to DD-MM-YYYY for CEP validation.
 * @param {Date} date
 * @returns {string}
 */
function formatCepDate(date) {
  var day = String(date.getDate()).padStart(2, "0");
  var month = String(date.getMonth() + 1).padStart(2, "0");
  var year = date.getFullYear();
  return day + "-" + month + "-" + year;
}

// ─── CEP HTML PARSER ──────────────────────────────────────────────────────

function parseCepTable(html) {
  var fieldMap = {
    "numero de referencia":           "reference",
    "clave de rastreo":              "trackingCode",
    "institucion emisora del pago":  "issuingBank",
    "institucion receptora del pago":"receivingBank",
    "estado del pago en banxico":    "status",
    "fecha y hora de recepcion":     "receptionDate",
    "fecha y hora de procesamiento": "processingDate",
    "cuenta beneficiaria":           "beneficiaryAccount",
    "monto":                         "amount",
  };

  var data = {};
  var re = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var label = stripAccents(
      decodeEntities(m[1].replace(/<[^>]+>/g, ""))
    ).toLowerCase().trim();
    var value = safeTrim(decodeEntities(m[2].replace(/<[^>]+>/g, "")));
    if (fieldMap[label]) data[fieldMap[label]] = value;
  }
  return data;
}

function parseStatusDescription(html, id) {
  if (!id) return null;
  var re = new RegExp(
    '<div[^>]*id="' + id + '"[^>]*>\\s*<h4>([\\s\\S]*?)</h4>\\s*<p>([\\s\\S]*?)</p>',
    "i"
  );
  var m = re.exec(html);
  if (m) {
    return {
      statusName: cleanHtml(m[1]),
      statusDescription: cleanHtml(m[2]),
    };
  }
  return null;
}

// ─── CRITERIO DETECTION ───────────────────────────────────────────────────

/**
 * Detects the type of search criteria.
 * @param {string} criterio - Reference (7 chars) or tracking code (8-30 chars)
 * @returns {"R"|"T"|null} - R=folio, T=tracking code, null=invalid
 */
function detectCriterioType(criterio) {
  var len = criterio.length;
  if (len === 7) return "R";
  if (len > 7 && len <= 30) return "T";
  return null;
}

// ─── CEP VALIDATION ───────────────────────────────────────────────────────

/**
 * Validates a CEP (Comprobante Electronico de Pago) against Banxico.
 *
 * @param {string} fecha    - Date in DD-MM-YYYY format
 * @param {string} criterio - Reference (7 chars) or tracking code (8-30 chars)
 * @param {string} emisor   - Issuing bank code (e.g. "40012")
 * @param {string} receptor - Receiving bank code (e.g. "40012")
 * @param {string} cuenta   - Beneficiary CLABE (18 digits)
 * @param {string} monto    - Amount (e.g. "100.00")
 * @returns {{ data: object, statusCode: number }}
 */
function validate(fecha, criterio, emisor, receptor, cuenta, monto) {
  var tipoCriterio = detectCriterioType(criterio);
  if (!tipoCriterio) {
    return {
      data: { found: false, message: "Invalid criterio length: must be 7 or 8-30 characters" },
      statusCode: 400,
    };
  }

  // Step 1: GET home page to obtain session cookies
  var resGet;
  try {
    resGet = $http.send({
      method: "GET",
      url: CEP_HOME_URL,
      timeout: 30,
      headers: {
        "accept": "*/*",
        "user-agent": UA,
        "accept-language": "es-US,es;q=0.9",
      },
    });
  } catch (err) {
    return { data: { found: false, message: "Failed to contact Banxico: " + err }, statusCode: 502 };
  }

  // Extract cookies
  var cookies = [];
  var setCookies = (resGet.headers && (resGet.headers["Set-Cookie"] || resGet.headers["set-cookie"])) || [];
  for (var i = 0; i < setCookies.length; i++) {
    var pair = String(setCookies[i]).split(";")[0].trim();
    if (pair.indexOf("=") > 0) cookies.push(pair);
  }
  if (cookies.length === 0 && resGet.cookies) {
    for (var name in resGet.cookies) {
      var ck = resGet.cookies[name];
      if (ck && ck.value) cookies.push(name + "=" + ck.value);
    }
  }

  // Step 2: POST validation request
  var params = {
    tipoCriterio: tipoCriterio,
    fecha: fecha,
    criterio: criterio,
    emisor: emisor,
    receptor: receptor,
    cuenta: cuenta,
    receptorParticipante: "0",
    monto: monto,
    captcha: "",
    tipoConsulta: "0",
  };

  var parts = [];
  var keys = Object.keys(params);
  for (var j = 0; j < keys.length; j++) {
    parts.push(encodeURIComponent(keys[j]) + "=" + encodeURIComponent(params[keys[j]]));
  }

  var resPost;
  try {
    resPost = $http.send({
      method: "POST",
      url: CEP_VALIDA_URL,
      body: parts.join("&"),
      timeout: 30,
      headers: {
        "accept": "*/*",
        "user-agent": UA,
        "accept-language": "es-US,es;q=0.9",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        "origin": CEP_ORIGIN,
        "referer": CEP_HOME_URL,
        "cookie": cookies.join("; "),
      },
    });
  } catch (err) {
    return { data: { found: false, message: "Failed to call Banxico validation: " + err }, statusCode: 502 };
  }

  var html = resPost.raw || "";

  if (resPost.json !== undefined && resPost.json !== null) {
    return { data: { found: false, raw: resPost.json }, statusCode: resPost.statusCode };
  }

  var datos = parseCepTable(html);
  var found = !!datos.status;

  if (!found) {
    var mensaje = "Operacion no encontrada.";
    var mInfo = /<div[^>]*class="info"[^>]*>[\s\S]*?<strong>([\s\S]*?)<\/strong>/i.exec(html);
    if (mInfo) {
      mensaje = cleanHtml(mInfo[1]);
    }
    return {
      data: { found: false, message: mensaje },
      statusCode: 404,
    };
  }

  var statusMap = {
    "en proceso":                "desc_EnProceso",
    "liquidado":                 "desc_Liquidado",
    "cancelado":                 "desc_Cancelado",
    "rechazado":                 "desc_Rechazado",
    "en proceso de devolucion":  "desc_EnProcesoDeDevolucion",
    "devuelto":                  "desc_Devuelto",
    "no liquidado":              "desc_CanceladoAlCierre",
    "no encontrado":             "desc_No_encontrado",
    "retornado":                 "desc_Retornado",
  };

  var statusName = null;
  var statusDescription = null;
  if (datos.status) {
    var clave = stripAccents(datos.status).toLowerCase().trim();
    var idEstado = statusMap[clave];
    var sv = parseStatusDescription(html, idEstado);
    if (sv) {
      statusName = sv.statusName;
      statusDescription = sv.statusDescription;
    } else {
      statusName = datos.status;
    }
  }

  return {
    data: {
      found: true,
      reference: datos.reference || null,
      trackingCode: datos.trackingCode || null,
      issuingBank: datos.issuingBank || null,
      receivingBank: datos.receivingBank || null,
      status: datos.status || null,
      receptionDate: datos.receptionDate || null,
      processingDate: datos.processingDate || null,
      beneficiaryAccount: datos.beneficiaryAccount || null,
      amount: datos.amount || null,
      statusName: statusName,
      statusDescription: statusDescription,
      message: null,
    },
    statusCode: 200,
  };
}

// ─── CEP RESULT EVALUATION ────────────────────────────────────────────────
// Shared logic for evaluating CEP validation results.
// Used by both spei_report_payment and spei_validate_cep.

/**
 * Evaluates a CEP validation result against expected values.
 *
 * @param {object} cepResult     - The CEP validation result data
 * @param {string} declaredAmount - The declared amount as string
 * @param {string} expectedAccount - The expected beneficiary CLABE
 * @returns {{ isMatch: boolean, newStatus: string, reason: string|null, shouldRetry: boolean }}
 */
function evaluateCepResult(cepResult, declaredAmount, expectedAccount) {
  if (!cepResult.found) {
    return { isMatch: false, newStatus: null, reason: "CEP not found", shouldRetry: true };
  }

  var cepAmount = parseFloat(cepResult.amount) || 0;
  var declared = parseFloat(declaredAmount) || 0;
  var cepAccount = cepResult.beneficiaryAccount || "";
  var cepStatus = (cepResult.status || "").toLowerCase();

  var amountMatch = Math.abs(cepAmount - declared) < 0.01;
  var accountMatch = cepAccount === expectedAccount;
  var statusMatch = cepStatus === "liquidado";

  var isExactMatch = amountMatch && accountMatch && statusMatch;

  if (isExactMatch) {
    return { isMatch: true, newStatus: "LIQUIDADO", reason: null, shouldRetry: false };
  }

  // Build mismatch reason
  var reasons = [];
  if (!amountMatch) reasons.push("amount mismatch");
  if (!accountMatch) reasons.push("account mismatch");
  if (!statusMatch) reasons.push("status not liquidado");
  var reason = reasons.join(", ");

  // Check if retry is possible (transfer in process)
  if (cepStatus.indexOf("en proceso") !== -1) {
    return { isMatch: false, newStatus: null, reason: reason, shouldRetry: true };
  }

  // Other status — reject
  return { isMatch: false, newStatus: "REJECTED", reason: reason, shouldRetry: false };
}

// ─── ORDER RESOLVER ───────────────────────────────────────────────────────

/**
 * Resolves the receptor bank code and CLABE from an order's spei_settings.
 *
 * @param {object} app    - PocketBase app instance ($app)
 * @param {object} order  - The spei_orders record
 * @returns {{ receptor: string, cuenta: string }}
 */
function resolveReceptorFromOrder(app, order) {
  var receptor = "";
  var cuenta = order.getString("cuenta_beneficiaria");

  var speiSettingsId = order.getString("spei_settings");
  if (speiSettingsId) {
    try {
      var speiSettings = app.findRecordById("spei_settings", speiSettingsId);
      receptor = speiSettings.getString("bank_code");
      if (!cuenta) {
        cuenta = speiSettings.getString("clabe");
      }
    } catch (_) {}
  }

  return { receptor: receptor, cuenta: cuenta };
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────

module.exports = {
  validate: validate,
  detectCriterioType: detectCriterioType,
  parseCepTable: parseCepTable,
  evaluateCepResult: evaluateCepResult,
  resolveReceptorFromOrder: resolveReceptorFromOrder,
  formatCepDate: formatCepDate,
};
