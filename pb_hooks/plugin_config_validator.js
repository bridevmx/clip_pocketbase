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
  console.log("  Setup Wizard (Recommended):");
  console.log("    Visit http://<your-domain>/setup to configure the plugin via UI.");
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

  // ── CRITICAL: Verify ENCRYPTION_KEY is configured ──────────────────
  var encKey = $os.getenv("ENCRYPTION_KEY");
  if (!encKey || encKey.trim() === "") {
    errors.push(
      "ENCRYPTION_KEY environment variable is not set.\n" +
      "      All credentials are encrypted at rest and REQUIRE this key.\n" +
      "      Set it in your Docker/Coolify environment before starting PocketBase.\n" +
      "      If this is a fresh install, run the Setup Wizard at /setup — it will\n" +
      "      generate a key for you. Copy it and add it to your environment."
    );
    // If ENCRYPTION_KEY is missing, all other checks will fail — report and return early
    printConfigBanner(errors, warnings);
    throw new Error("[PAYMENTS PLUGIN] Startup aborted: ENCRYPTION_KEY is not configured.");
  }
  if (encKey.trim().length < 32) {
    errors.push(
      "ENCRYPTION_KEY is too short (" + encKey.trim().length + " chars). Minimum is 32 characters.\n" +
      "      Generate a new key: openssl rand -hex 32\n" +
      "      Or use the Setup Wizard at /setup to generate one."
    );
    printConfigBanner(errors, warnings);
    throw new Error("[PAYMENTS PLUGIN] Startup aborted: ENCRYPTION_KEY is too short.");
  }

  var psh = require(`${__hooks}/plugin_settings_helper.js`);
  var envHelper = require(`${__hooks}/env_helper.js`);

  var isConfigured = psh.getSetting("is_configured", "false");
  var clipApiKey   = envHelper.getEnv("clip_api_key") || envHelper.getEnv("CLIP_API_KEY") || "";
  var pbUrl        = envHelper.getEnv("pocketbase_url") || envHelper.getEnv("POCKETBASE_URL") || "";

  // If setup wizard has not been completed and environment variables are absent,
  // do not throw fatal error. Display friendly wizard instruction banner.
  if (isConfigured !== "true" && (!clipApiKey || !pbUrl)) {
    console.log("");
    console.log(SEPARATOR);
    console.log("  PAYMENTS PLUGIN — SETUP REQUIRED");
    console.log(SEPARATOR);
    console.log("");
    console.log("  ⚠ The Clip / SPEI payments plugin is not fully configured yet.");
    console.log("  Please complete the setup wizard by navigating to:");
    console.log("");
    console.log("    " + (pbUrl || "http://<your-domain>") + "/setup");
    console.log("");
    console.log("  Or provide CLIP_API_KEY and POCKETBASE_URL environment variables.");
    console.log(SEPARATOR);
    console.log("");
    return;
  }

  // ── CRITICAL: Configuration checks ───────────────────────────────────

  if (!clipApiKey || clipApiKey.trim() === "") {
    errors.push(
      "CLIP_API_KEY is not set.\n" +
      "      Get your token from https://dashboard.payclip.com → API Keys.\n" +
      "      Set it as: export CLIP_API_KEY=\"Basic <base64token>\" or visit /setup"
    );
  } else if (clipApiKey.length < 20) {
    errors.push(
      "CLIP_API_KEY looks invalid (too short: " + clipApiKey.length + " chars).\n" +
      "      Expected format: \"Basic <base64token>\" or just the base64 token."
    );
  }

  if (!pbUrl || pbUrl.trim() === "") {
    errors.push(
      "POCKETBASE_URL is not set.\n" +
      "      This is the public URL of your PocketBase instance.\n" +
      "      It is used to build the Clip webhook callback URL.\n" +
      "      Set it as: export POCKETBASE_URL=\"https://your-domain.com\" or visit /setup"
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

  // ── Encrypted system settings checks ─────────────────────────────────
  try {
    var secretVal = envHelper.getEnv("clip_webhook_secret");
    if (!secretVal || secretVal.trim() === "") {
      var autoSecret = $security.randomString(32);
      envHelper.setEnv("clip_webhook_secret", autoSecret, true);
      warnings.push(
        "clip_webhook_secret was empty in z_system_settings_do_not_touch.\n" +
        "      Auto-generated secure random secret: " + autoSecret + "\n" +
        "      Webhook URL: " + (pbUrl || "<POCKETBASE_URL>") + "/api/clip/webhook?token=" + autoSecret
      );
    } else if (secretVal.length < 16) {
      warnings.push(
        "clip_webhook_secret is short (" + secretVal.length + " chars).\n" +
        "      Recommend using a random UUID or 32-character string for production."
      );
    }
  } catch (secErr) {
    warnings.push("Could not read/write clip_webhook_secret in z_system_settings_do_not_touch: " + secErr.message);
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
      "Fix the issues above or complete setup at /setup and restart PocketBase."
    );
  }

  // All good
  console.log("[PAYMENTS PLUGIN] Configuration validated. All systems operational.");
}

module.exports = Object.freeze({ validate: validate });
