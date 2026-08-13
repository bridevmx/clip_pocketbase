/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// system_vault_api.pb.js — System Encryption Vault Management Routes
//
// Endpoints:
//   POST /api/v1/system/vault/unlock            — Unlock vault using security key
//   POST /api/v1/system/vault/enable-passphrase  — Enable or update vault security key / passphrase
//   GET  /api/v1/system/vault/status             — Retrieve current vault status
// ─────────────────────────────────────────────────────────────────────────

(function () {
    routerAdd("POST", "/api/v1/system/vault/unlock", (e) => {
        const { requireSuperuser } = require(`${__hooks}/system_auth.js`);
        const { checkLimit } = require(`${__hooks}/rate_limiter.js`);
        const envHelper = require(`${__hooks}/env_helper.js`);

        // Rate limiting — 5 attempts / 15 minutes (executed as first check)
        const clientIp = e.realIP ? e.realIP() : "unknown";
        const limit = checkLimit("vault_unlock:" + clientIp, 5, 900000);
        if (!limit.allowed) {
            return e.json(429, {
                success: false,
                status: "error",
                code: "rate_limited",
                message: "Too many unlock attempts. Please try again after 15 minutes."
            });
        }

        requireSuperuser(e);

        const info = e.requestInfo();
        const data = info ? (info.body || {}) : {};
        const securityKey = (data.security_key || data.securityKey || data.passphrase || "").toString().trim();

        if (!securityKey) {
            return e.json(400, {
                success: false,
                status: "error",
                code: "missing_fields",
                message: "Field 'security_key' is required."
            });
        }

        try {
            envHelper.unlockVault(securityKey);
            return e.json(200, {
                success: true,
                status: "success",
                message: "Vault unlocked successfully.",
                vault: envHelper.getVaultStatus()
            });
        } catch (err) {
            console.log("[SYSTEM VAULT API ERROR] Unlock failed:", err.message);
            return e.json(400, {
                success: false,
                status: "error",
                code: "unlock_failed",
                message: err.message || "Failed to unlock vault."
            });
        }
    });

    routerAdd("POST", "/api/v1/system/vault/enable-passphrase", (e) => {
        const { requireSuperuser } = require(`${__hooks}/system_auth.js`);
        const { checkLimit } = require(`${__hooks}/rate_limiter.js`);
        const envHelper = require(`${__hooks}/env_helper.js`);

        // Rate limiting — 5 attempts / 15 minutes (executed as first check)
        const clientIp = e.realIP ? e.realIP() : "unknown";
        const limit = checkLimit("vault_passphrase:" + clientIp, 5, 900000);
        if (!limit.allowed) {
            return e.json(429, {
                success: false,
                status: "error",
                code: "rate_limited",
                message: "Too many passphrase attempts. Please try again after 15 minutes."
            });
        }

        requireSuperuser(e);

        const info = e.requestInfo();
        const data = info ? (info.body || {}) : {};
        const newSecurityKey = (data.new_security_key || data.newSecurityKey || data.passphrase || data.security_key || "").toString().trim();
        const currentSecurityKey = (data.current_security_key || data.currentSecurityKey || "").toString().trim();

        if (!newSecurityKey) {
            return e.json(400, {
                success: false,
                status: "error",
                code: "missing_fields",
                message: "Field 'new_security_key' is required."
            });
        }

        const currentStatus = envHelper.getVaultStatus();

        if (currentStatus.wrapped) {
            if (!currentSecurityKey) {
                return e.json(400, {
                    success: false,
                    status: "error",
                    code: "current_key_required",
                    message: "Parameter 'current_security_key' is required to update passphrase on a wrapped vault."
                });
            }
            try {
                envHelper.unlockVault(currentSecurityKey);
            } catch (unlockErr) {
                return e.json(400, {
                    success: false,
                    status: "error",
                    code: "invalid_current_key",
                    message: "Current security key verification failed: " + unlockErr.message
                });
            }
        }

        try {
            envHelper.wrapVault(newSecurityKey);
            return e.json(200, {
                success: true,
                status: "success",
                message: "Passphrase enabled and master key wrapped successfully.",
                vault: envHelper.getVaultStatus()
            });
        } catch (err) {
            console.log("[SYSTEM VAULT API ERROR] Enable passphrase failed:", err.message);
            return e.json(400, {
                success: false,
                status: "error",
                code: "passphrase_failed",
                message: err.message || "Failed to enable passphrase."
            });
        }
    });

    routerAdd("GET", "/api/v1/system/vault/status", (e) => {
        const { requireSuperuser } = require(`${__hooks}/system_auth.js`);
        const envHelper = require(`${__hooks}/env_helper.js`);

        requireSuperuser(e);

        try {
            const vaultStatus = envHelper.getVaultStatus();
            return e.json(200, {
                success: true,
                status: "success",
                vault: vaultStatus
            });
        } catch (err) {
            console.log("[SYSTEM VAULT API ERROR] Vault status check failed:", err.message);
            return e.json(500, {
                success: false,
                status: "error",
                code: "vault_status_error",
                message: "Failed to retrieve vault status."
            });
        }
    });
})();
