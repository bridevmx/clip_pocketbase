/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// GET /api/spei/form — Serve the SPEI CEP form via iframe.
//
// Returns an HTML wrapper that loads the form from pb_public/.
// ─────────────────────────────────────────────────────────────────────────

routerAdd("GET", "/api/spei/form", (e) => {
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;">';
  html += '<iframe src="/spei-cep-form.html" style="width:100%;height:100vh;border:none;"></iframe>';
  html += '</body></html>';

  return e.html(200, html);
});
