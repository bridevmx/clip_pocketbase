/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// SPEI CEP API client — CommonJS module, shared via require().
//
// Usage in any pb_hooks/*.pb.js file:
//   const spei = require(`${__hooks}/spei_api_client.js`);
//   const result = spei.validate(fecha, criterio, emisor, receptor, cuenta, monto);
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
    .replace(/&iacute;/g, "i").replace(/& конкуó/g, "o")
    .replace(/&oacute;/g, "o").replace(/&uacute;/g, "u").replace(/&ntilde;/g, "n")
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
 * Formats a Date object or ISO string to DD-MM-YYYY in America/Mexico_City timezone.
 * @param {Date|string} dateInput
 * @returns {string}
 */
function formatCepDate(dateInput) {
  var d = new Date(dateInput);
  var mexStr = d.toLocaleString("en-US", { timeZone: "America/Mexico_City" });
  var mexDate = new Date(mexStr);
  var day = String(mexDate.getDate()).padStart(2, "0");
  var month = String(mexDate.getMonth() + 1).padStart(2, "0");
  var year = mexDate.getFullYear();
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
  if (!m) return null;
  return {
    statusName: cleanHtml(m[1]),
    statusDescription: cleanHtml(m[2]),
  };
}

/**
 * Detects whether criterio is a reference (7 digits) or tracking code (8-30 chars).
 * @param {string} criterio
 * @returns {"R"|"T"|null}
 */
function detectCriterioType(criterio) {
  if (!criterio) return null;
  criterio = safeTrim(criterio);
  if (/^\d{7}$/.test(criterio)) return "R";
  if (criterio.length >= 8 && criterio.length <= 30) return "T";
  return null;
}

// ─── VALIDATE (MAIN SCRAPER) ──────────────────────────────────────────────

/**
 * Validates a SPEI transfer via Banxico CEP portal.
 *
 * @param {string} fecha       - Format "DD-MM-YYYY"
 * @param {string} criterio    - Reference (7 digits) or tracking code (8-30 chars)
 * @param {string} emisor      - Issuing bank code (5 digits, e.g. "40012")
 * @param {string} receptor    - Receiving bank code (5 digits, e.g. "40012")
 * @param {string} cuenta      - Beneficiary CLABE (18 digits)
 * @param {number|string} monto- Transfer amount (e.g. 1500.50)
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

/**
 * Parses a CEP date string "DD/MM/YYYY HH:MM:SS" to a Date object.
 * @param {string} dateStr
 * @returns {Date|null}
 */
function parseCepDate(dateStr) {
  if (!dateStr) return null;
  try {
    var parts = dateStr.split(" ");
    var dateParts = parts[0].split("/");
    var timeParts = parts[1] ? parts[1].split(":") : ["00", "00", "00"];
    return new Date(
      parseInt(dateParts[2]),
      parseInt(dateParts[1]) - 1,
      parseInt(dateParts[0]),
      parseInt(timeParts[0]),
      parseInt(timeParts[1]),
      parseInt(timeParts[2] || "0")
    );
  } catch (_) {
    return null;
  }
}

/**
 * Evaluates CEP scraper result against expected order details.
 *
 * @param {object} cepResult       - The data object from validate()
 * @param {string} declaredAmount - The declared amount as string
 * @param {string} expectedAccount - The expected beneficiary CLABE
 * @returns {{ isMatch: boolean, newStatus: string, reason: string|null, shouldRetry: boolean }}
 */
function evaluateCepResult(cepResult, declaredAmount, expectedAccount) {
  if (!cepResult || !cepResult.found) {
    return { isMatch: false, newStatus: null, reason: "CEP not found", shouldRetry: true };
  }

  var cepAmount = parseFloat(cepResult.amount) || 0;
  var declared = parseFloat(declaredAmount) || 0;
  var cepAccount = cepResult.beneficiaryAccount || "";
  var cepStatus = (cepResult.status || "").toLowerCase();

  var amountMatch = Math.abs(cepAmount - declared) < 0.01;
  var accountMatch = cepAccount === expectedAccount;
  var statusMatch = cepStatus === "liquidado";

  // ─── SECURITY: Validate CEP is not stale (max 24 hours old) ───────────
  if (cepResult.processingDate) {
    var cepDate = parseCepDate(cepResult.processingDate);
    if (cepDate) {
      var now = new Date();
      var diffHours = (now - cepDate) / (1000 * 60 * 60);
      if (diffHours > 24) {
        return {
          isMatch: false,
          newStatus: "REJECTED",
          reason: "CEP is too old (processed more than 24 hours ago)",
          shouldRetry: false,
        };
      }
    }
  }

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

/**
 * Resolves the receptor bank code and CLABE from an order's spei_settings.
 * Automatically deduces 5-digit bank code from 18-digit CLABE prefix if needed.
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

  if (!receptor || !cuenta) {
    try {
      var defaultSettings = app.findFirstRecordByFilter("spei_settings", "is_active = true");
      if (!receptor && defaultSettings) receptor = defaultSettings.getString("bank_code");
      if (!cuenta && defaultSettings) cuenta = defaultSettings.getString("clabe");
    } catch (_) {}
  }

  // Deducir código de 5 dígitos del Banco Receptor mediante los primeros 3 dígitos de la CLABE (estándar Banco de México)
  if (cuenta && cuenta.length === 18 && (!receptor || receptor.length < 4 || isNaN(parseInt(receptor)))) {
    var clabePrefix = cuenta.substring(0, 3);
    var clabeBankMap = {
      "012": "40012", // BBVA
      "072": "40072", // Banorte
      "002": "40002", // Banamex
      "014": "40014", // Santander
      "021": "40021", // HSBC
      "044": "40044", // Scotiabank
      "058": "40058", // Banregio
      "062": "40062", // Afirme
      "127": "40127", // Azteca
      "137": "40137", // Coppel
      "638": "90638", // Spin by OXXO
      "846": "40846", // STP
    };
    if (clabeBankMap[clabePrefix]) {
      receptor = clabeBankMap[clabePrefix];
    }
  }

  return { receptor: receptor, cuenta: cuenta };
}

/**
 * Validates all SPEI input parameters against strict whitelists.
 * Call this before any external HTTP request to Banxico.
 * Throws BadRequestError if any input is invalid.
 *
 * @param {string} criterio - 7-digit reference OR 8-30 alphanumeric tracking code
 * @param {string} emisor - 5-digit Banxico bank code
 * @param {string} cuenta - 18-digit CLABE beneficiary account
 * @param {string|number} monto - positive amount with up to 2 decimal places
 */
function validateSpeiInputs(criterio, emisor, cuenta, monto) {
  // criterio: 7 numeric digits (reference) OR 8-30 strict alphanumeric (tracking code)
  if (!/^\d{7}$/.test(criterio) && !/^[A-Za-z0-9]{8,30}$/.test(criterio)) {
    throw new BadRequestError(
      "Invalid criterio format: must be exactly 7 digits (reference) or 8-30 alphanumeric characters (tracking code)"
    );
  }

  // emisor: exactly 5 digits (Banxico institution code)
  if (!/^\d{5}$/.test(emisor)) {
    throw new BadRequestError(
      "Invalid sender bank code (emisor): must be exactly 5 digits"
    );
  }

  // cuenta: exactly 18 digits (CLABE)
  if (!/^\d{18}$/.test(cuenta)) {
    throw new BadRequestError(
      "Invalid beneficiary account (cuenta): must be exactly 18 digits (CLABE format)"
    );
  }

  // monto: positive number with up to 2 decimal places, > 0
  var montoStr = String(monto).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(montoStr) || parseFloat(montoStr) <= 0) {
    throw new BadRequestError(
      "Invalid amount (monto): must be a positive number with up to 2 decimal places"
    );
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────

module.exports = {
  validate: validate,
  validateSpeiInputs: validateSpeiInputs,
  detectCriterioType: detectCriterioType,
  parseCepTable: parseCepTable,
  parseCepDate: parseCepDate,
  evaluateCepResult: evaluateCepResult,
  resolveReceptorFromOrder: resolveReceptorFromOrder,
  formatCepDate: formatCepDate,
};
