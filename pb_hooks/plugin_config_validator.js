/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// plugin_config_validator.js — Startup configuration validator.
//
// Validates all required environment variables and plugin settings at
// PocketBase startup. If any CRITICAL config is missing, prints a clear
// error banner and throws an error to halt PocketBase boot.
//
// Called from clip_00_bootstrap.pb.js inside onBootstrap().
// ─────────────────────────────────────────────────────────────────────────

var SEPARATOR = "═".repeat(60);
var THIN_SEP  = "─".repeat(60);

/**
 * Prints a formatted error banner to stderr/stdout.
 * @param {string[]} errors - List of error messages
 * @param {string[]} warnings - List of warning messages
 */
function printConfigBanner(errors, warnings) {
  console.log("");
  console.log(SEPARATOR);
  console.log("  PAYMENTS PLUGIN — CONFIGURATION ERROR");
  console.log(SEPARATOR);

  if (errors.length > 0) {
    console.log("");
    console.log("  ✗ CRITICAL — PocketBase will NOT start until these are fixed:");
    console.log("");
    for (var i = 0; i < errors.length; i++) {
      console.log("    • " + errors[i]);
    }
  }

  if (warnings.length > 0) {
    console.log("");
    console.log("  ⚠ WARNINGS — Plugin will start but these are insecure:");
    console.log("");
    for (var j = 0; j < warnings.length; j++) {
      console.log("    • " + warnings[j]);
    }
  }

  console.log("");
  console.log(THIN_SEP);
  console.log("  HOW TO FIX:");
  console.log("");
  console.log("  Environment variables (set before starting PocketBase):");
  console.log("    export CLIP_API_KEY=\"Basic <your_clip_token>\"");
  console.log("    export POCKETBASE_URL=\"https://your-pocketbase-domain.com\"");
  console.log("");
  console.log("  PocketBase Admin UI → plugin_settings collection:");
  console.log("    clip_webhook_secret  →  set to a random UUID");
  console.log("    admin_user_ids       →  comma-separated user IDs");
  console.log("");
  console.log("  PocketBase Admin UI → spei_settings collection:");
  console.log("    Create at least one active SPEI bank account (CLABE)");
  console.log("");
  console.log(SEPARATOR);
  console.log("");
}

/**
 * Validates all required plugin configuration.
 * Throws an Error if any CRITICAL config is missing (halts PocketBase).
 * Logs warnings for insecure-but-non-fatal settings.
 *
 * @param {object} app - PocketBase $app instance
 * @throws {Error} if any critical config is missing
 */
function validate(app) {
  var errors   = [];
  var warnings = [];

  // ── CRITICAL: Environment variables ───────────────────────────────────

  var clipApiKey = $os.getenv("CLIP_API_KEY");
  if (!clipApiKey || clipApiKey.trim() === "") {
    errors.push(
      "CLIP_API_KEY is not set.\n" +
      "      Get your token from https://dashboard.payclip.com → API Keys.\n" +
      "      Set it as: export CLIP_API_KEY=\"Basic <base64token>\""
    );
  } else if (clipApiKey.length < 20) {
    errors.push(
      "CLIP_API_KEY looks invalid (too short: " + clipApiKey.length + " chars).\n" +
      "      Expected format: \"Basic <base64token>\" or just the base64 token."
    );
  }

  var pbUrl = $os.getenv("POCKETBASE_URL");
  if (!pbUrl || pbUrl.trim() === "") {
    errors.push(
      "POCKETBASE_URL is not set.\n" +
      "      This is the public URL of your PocketBase instance.\n" +
      "      It is used to build the Clip webhook callback URL.\n" +
      "      Set it as: export POCKETBASE_URL=\"https://your-domain.com\""
    );
  } else if (!pbUrl.startsWith("http://") && !pbUrl.startsWith("https://")) {
    errors.push(
      "POCKETBASE_URL is invalid: \"" + pbUrl + "\".\n" +
      "      Must start with http:// or https://"
    );
  } else if (pbUrl.startsWith("http://") && pbUrl.indexOf("localhost") === -1 && pbUrl.indexOf("127.0.0.1") === -1) {
    warnings.push(
      "POCKETBASE_URL uses http:// in a non-localhost context: \"" + pbUrl + "\".\n" +
      "      Clip webhooks require HTTPS in production. Use https:// instead."
    );
  }

  // ── CRITICAL: plugin_settings collection checks ────────────────────────
  // These checks only run if the DB is accessible (migrations already ran).

  try {
    app.findCollectionByNameOrId("plugin_settings");

    // clip_webhook_secret — CRITICAL: must be set in production
    try {
      var secretRec = app.findFirstRecordByFilter(
        "plugin_settings",
        "key = {:key}",
        { key: "clip_webhook_secret" }
      );
      var secretVal = secretRec ? secretRec.getString("value") : "";
      if (!secretVal || secretVal.trim() === "") {
        // Check if we are in a local/dev environment (http://localhost or 127.0.0.1)
        var isLocal = pbUrl && (pbUrl.indexOf("localhost") !== -1 || pbUrl.indexOf("127.0.0.1") !== -1);
        if (isLocal) {
          warnings.push(
            "clip_webhook_secret is not configured in plugin_settings.\n" +
            "      (Allowed for local development, but REQUIRED in production)\n" +
            "      Set it to a random UUID in: Admin UI → plugin_settings → clip_webhook_secret"
          );
        } else {
          errors.push(
            "clip_webhook_secret is empty in plugin_settings.\n" +
            "      Without a secret token, anyone can send fake webhooks to your endpoint.\n" +
            "      Set it to a random UUID in: Admin UI → plugin_settings → clip_webhook_secret\n" +
            "      Then register the webhook URL in Clip dashboard as:\n" +
            "      " + (pbUrl || "<POCKETBASE_URL>") + "/api/clip/webhook?token=<your_secret>"
          );
        }
      } else if (secretVal.length < 16) {
        errors.push(
          "clip_webhook_secret is too short (" + secretVal.length + " chars).\n" +
          "      Use a random UUID or at least 32 random characters for security."
        );
      }
    } catch (_) {
      warnings.push("Could not read clip_webhook_secret from plugin_settings (record may not exist yet).");
    }

  } catch (_) {
    // plugin_settings collection doesn't exist yet — migrations haven't run.
    // This is normal on first boot before migrations. Skip DB checks.
    warnings.push(
      "plugin_settings collection not found — migrations may not have run yet.\n" +
      "      If this persists after first boot, check your pb_migrations/ folder."
    );
  }

  // ── WARNING: spei_settings — at least one active account ──────────────
  try {
    app.findCollectionByNameOrId("spei_settings");
    try {
      var activeSpei = app.findFirstRecordByFilter(
        "spei_settings",
        "is_active = true"
      );
      if (!activeSpei) {
        warnings.push(
          "No active SPEI bank account found in spei_settings.\n" +
          "      SPEI payments will fail until you add at least one active account.\n" +
          "      Add it in: Admin UI → spei_settings → Create record"
        );
      }
    } catch (_) {
      warnings.push(
        "No active SPEI bank account found in spei_settings.\n" +
        "      SPEI payments will fail until you add at least one active account."
      );
    }
  } catch (_) {
    // spei_settings doesn't exist yet — normal before migrations
  }

  // ── Print banner and halt if critical errors ───────────────────────────

  if (errors.length > 0 || warnings.length > 0) {
    printConfigBanner(errors, warnings);
  }

  if (errors.length > 0) {
    throw new Error(
      "[PAYMENTS PLUGIN] Startup aborted: " + errors.length + " critical configuration error(s). " +
      "Fix the issues above and restart PocketBase."
    );
  }

  // All good
  console.log("[PAYMENTS PLUGIN] Configuration validated. All systems operational.");
}

module.exports = Object.freeze({ validate: validate });
