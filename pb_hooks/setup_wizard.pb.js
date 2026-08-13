/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// setup_wizard.pb.js — Interactive Setup Wizard Routes.
//
// Endpoints:
//   GET  /api/plugin/setup-status  — Public status check
//   GET  /setup                    — Serve setup UI or redirect if configured
//   POST /api/plugin/setup         — Save configuration (Superuser auth)
// ─────────────────────────────────────────────────────────────────────────

routerAdd("GET", "/api/plugin/setup-status", (e) => {
  var psh = require(`${__hooks}/plugin_settings_helper.js`);
  var isConfigured = psh.getSetting("is_configured", "false") === "true";

  var pbUrl = psh.getEnvOrSetting("POCKETBASE_URL", "pocketbase_url", "");
  if (!pbUrl) {
    var reqInfo = e.requestInfo();
    var headers = reqInfo ? (reqInfo.headers || {}) : {};
    var host = headers["host"] || (e.request && e.request.header ? e.request.header.get("Host") : "");
    if (host) {
      var proto = headers["x-forwarded-proto"] || (e.request && e.request.header ? e.request.header.get("X-Forwarded-Proto") : "http");
      pbUrl = proto + "://" + host;
    }
  }

  return e.json(200, {
    is_configured: isConfigured,
    pocketbase_url_suggestion: pbUrl || ""
  });
});

routerAdd("GET", "/setup", (e) => {
  var paths = [
    "/pb/pb_public/setup.html",
    __hooks + "/../pb_public/setup.html",
    "./pb_public/setup.html"
  ];

  for (var i = 0; i < paths.length; i++) {
    try {
      var content = $os.readFile(paths[i]);
      if (content) {
        return e.html(200, content);
      }
    } catch (_) {}
  }

  throw new NotFoundError("setup.html not found in pb_public");
});

routerAdd("POST", "/api/plugin/setup", (e) => {
  var info = e.requestInfo();
  var body = info.body || {};

  // ── Authentication Check ───────────────────────────────────────────────
  var isSuperuser = false;

  if (e.hasSuperuserAuth()) {
    isSuperuser = true;
  } else if (body.identity && body.password) {
    var adminRecord = null;
    try {
      adminRecord = $app.findAuthRecordByEmail("_superusers", body.identity.toString());
    } catch (_) {
      try {
        adminRecord = $app.findAuthRecordByUsername("_superusers", body.identity.toString());
      } catch (_) {}
    }

    if (adminRecord && $app.validatePassword(adminRecord, body.password.toString())) {
      isSuperuser = true;
    }
  }

  if (!isSuperuser) {
    throw new ForbiddenError("Superuser authentication required.");
  }

  // ── Input Validation ───────────────────────────────────────────────────
  var clipApiKey = (body.clip_api_key || "").toString().trim();
  var pbUrl = (body.pocketbase_url || "").toString().trim();
  var clipWebhookSecret = (body.clip_webhook_secret || "").toString().trim();
  var adminUserIds = body.admin_user_ids !== undefined ? body.admin_user_ids.toString().trim() : "";

  if (!clipApiKey || clipApiKey.length < 20) {
    throw new BadRequestError("Invalid clip_api_key. Must be at least 20 characters.");
  }

  if (!pbUrl || (!pbUrl.startsWith("http://") && !pbUrl.startsWith("https://"))) {
    throw new BadRequestError("Invalid pocketbase_url. Must start with http:// or https://");
  }

  // ── Upsert Settings ───────────────────────────────────────────────────
  function upsertSetting(key, val) {
    var col = $app.findCollectionByNameOrId("plugin_settings");
    var rec = null;
    try {
      rec = $app.findFirstRecordByFilter("plugin_settings", "key = {:key}", { key: key });
    } catch (_) {}

    if (!rec) {
      rec = new Record(col);
      rec.set("key", key);
    }
    rec.set("value", val);
    $app.save(rec);
  }

  upsertSetting("clip_api_key", clipApiKey);
  upsertSetting("pocketbase_url", pbUrl);
  if (clipWebhookSecret) {
    upsertSetting("clip_webhook_secret", clipWebhookSecret);
  }
  if (body.admin_user_ids !== undefined) {
    upsertSetting("admin_user_ids", adminUserIds);
  }
  upsertSetting("is_configured", "true");

  return e.json(200, {
    success: true,
    message: "Plugin configuration completed successfully."
  });
});
