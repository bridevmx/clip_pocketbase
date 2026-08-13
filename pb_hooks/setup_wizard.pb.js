/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// setup_wizard.pb.js — Interactive Setup Wizard Routes.
//
// Endpoints:
//   GET  /api/plugin/setup-status  — Public status check
//   GET  /setup                    — Serve setup UI
//   POST /api/plugin/setup         — Save configuration (Superuser auth)
// ─────────────────────────────────────────────────────────────────────────

var SETUP_HTML_EMBEDDED = `<!DOCTYPE html>
<html lang="es" class="h-full bg-slate-950">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configuración de Plugin Clip — PocketBase</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            clip: {
              500: '#ff5f00',
              600: '#e05300',
            }
          }
        }
      }
    }
  </script>
</head>
<body class="h-full bg-slate-950 text-slate-100 antialiased font-sans min-h-screen flex flex-col justify-between py-10 px-4 sm:px-6 lg:px-8">
  
  <div class="sm:mx-auto sm:w-full sm:max-w-xl">
    <!-- Header Logo & Title -->
    <div class="text-center mb-8">
      <div class="inline-flex items-center justify-center space-x-3 bg-slate-900/80 p-3.5 rounded-2xl border border-slate-800 shadow-xl mb-4">
        <span class="text-2xl font-bold text-clip-500 tracking-wider">CLIP</span>
        <span class="text-slate-600 text-xl font-light">×</span>
        <span class="text-2xl font-extrabold text-slate-100 tracking-tight">PocketBase</span>
      </div>
      <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">
        Configuración Inicial del Plugin
      </h1>
      <p class="mt-2 text-sm text-slate-400">
        Asistente seguro de inicialización y credenciales para Clip México.
      </p>
    </div>

    <!-- Status Banner (Shown if already configured) -->
    <div id="alreadyConfiguredBanner" class="hidden mb-6 bg-slate-900/90 border border-emerald-500/40 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
      <div class="flex items-start space-x-4">
        <div class="flex-shrink-0 bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/20 text-emerald-400">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div class="flex-1">
          <h3 class="text-base font-semibold text-emerald-400">Plugin Ya Configurado</h3>
          <p class="mt-1 text-sm text-slate-300">
            Este entorno ya cuenta con las credenciales y ajustes del plugin de Clip inicializados.
          </p>
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <a href="/_/" class="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-slate-900 bg-emerald-400 hover:bg-emerald-300 rounded-xl transition shadow-md">
              Ir a PocketBase Admin UI
              <svg class="w-4 h-4 ml-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </a>
            <button type="button" id="btnReconfigure" class="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white rounded-xl border border-slate-700 transition">
              Reconfigurar Credenciales
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Global Alert Box -->
    <div id="alertBox" role="alert" class="hidden mb-6 rounded-xl p-4 text-sm font-medium transition-all"></div>

    <!-- Main Setup Form Card -->
    <div id="formCard" class="bg-slate-900/80 border border-slate-800 shadow-2xl rounded-2xl p-6 sm:p-8 backdrop-blur-sm">
      <form id="setupForm" class="space-y-6">
        
        <!-- Section 1: Superuser Credentials -->
        <div>
          <div class="flex items-center space-x-2 border-b border-slate-800 pb-3 mb-4">
            <svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <h2 class="text-base font-semibold text-slate-200">Autenticación de Superusuario</h2>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label for="identity" class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Email / Usuario Superadmin <span class="text-rose-400">*</span>
              </label>
              <input type="email" id="identity" required placeholder="admin@example.com"
                class="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition">
            </div>

            <div>
              <label for="password" class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Contraseña <span class="text-rose-400">*</span>
              </label>
              <div class="relative">
                <input type="password" id="password" required placeholder="••••••••••••"
                  class="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-3.5 pr-10 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition">
                <button type="button" id="togglePasswordBtn" class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300">
                  <span class="sr-only">Mostrar u ocultar contraseña</span>
                  <svg id="eyeIcon1" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Section 2: Clip Integration Settings -->
        <div>
          <div class="flex items-center space-x-2 border-b border-slate-800 pb-3 mb-4">
            <svg class="w-5 h-5 text-clip-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            <h2 class="text-base font-semibold text-slate-200">Credenciales de Clip México</h2>
          </div>

          <div class="space-y-4">
            <!-- Clip API Key -->
            <div>
              <label for="clipApiKey" class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Clip API Key (Basic Auth) <span class="text-rose-400">*</span>
              </label>
              <div class="relative">
                <input type="password" id="clipApiKey" required placeholder="Basic Standard_..."
                  class="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-3.5 pr-10 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-clip-500 focus:ring-1 focus:ring-clip-500 transition font-mono">
                <button type="button" id="toggleApiKeyBtn" class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300">
                  <span class="sr-only">Mostrar u ocultar API Key</span>
                  <svg id="eyeIcon2" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
              </div>
              <p class="mt-1 text-xs text-slate-500">Formato Basic &lt;token&gt; obtenido desde el Dashboard Developer de Clip.</p>
            </div>

            <!-- PocketBase Base URL -->
            <div>
              <label for="pocketbaseUrl" class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                PocketBase URL pública <span class="text-rose-400">*</span>
              </label>
              <input type="url" id="pocketbaseUrl" required placeholder="https://tu-dominio.com"
                class="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition font-mono">
              <p class="mt-1 text-xs text-slate-500">URL base donde se encuentra escuchando PocketBase.</p>
            </div>

            <!-- Webhook Secret Token -->
            <div>
              <label for="webhookSecret" class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Webhook Secret Token <span class="text-rose-400">*</span>
              </label>
              <div class="flex space-x-2">
                <input type="text" id="webhookSecret" required placeholder="uuid-o-secreto"
                  class="flex-1 bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition font-mono">
                <button type="button" id="btnGenUuid" class="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition flex items-center whitespace-nowrap">
                  🎲 Generar UUID
                </button>
              </div>
            </div>

            <!-- Webhook URL Interactive Preview -->
            <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5">
              <div class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Vista Previa de URL de Webhook:</div>
              <div id="webhookPreview" class="text-xs font-mono text-indigo-300 break-all select-all">
                https://...
              </div>
            </div>

            <!-- Admin User IDs (Optional) -->
            <div>
              <label for="adminUserIds" class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Admin User IDs de PocketBase <span class="text-slate-500 font-normal lowercase">(opcional)</span>
              </label>
              <input type="text" id="adminUserIds" placeholder="usr_id1, usr_id2"
                class="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition font-mono">
              <p class="mt-1 text-xs text-slate-500">
                Lista de IDs de usuario separados por comas que tendrán permisos administrativos en la colección. 
                <span class="text-slate-400">Nota: Los superusuarios de PocketBase ya cuentan con acceso total implícito.</span>
              </p>
            </div>

            <!-- Security Key / Passphrase (Optional for PaaS / Coolify automated redeploys) -->
            <div class="border-t border-slate-800/80 pt-4">
              <label for="securityKey" class="block text-xs font-semibold uppercase tracking-wider text-amber-400/90 mb-1.5 flex items-center space-x-1.5">
                <svg class="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span>Clave de Seguridad (SECURITY_KEY) <span class="text-slate-500 font-normal lowercase">(opcional / recomendado PaaS)</span></span>
              </label>
              <div class="flex space-x-2">
                <div class="relative flex-1">
                  <input type="password" id="securityKey" placeholder="Dejar vacío para auto-generar en disco"
                    class="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-3.5 pr-10 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition font-mono">
                  <button type="button" id="toggleSecurityKeyBtn" class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300">
                    <span class="sr-only">Mostrar u ocultar clave</span>
                    <svg id="eyeIcon3" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                </div>
                <button type="button" id="btnGenSecKey" class="px-3.5 py-2.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-semibold rounded-xl transition flex items-center whitespace-nowrap">
                  🎲 Generar Clave
                </button>
              </div>
              <p class="mt-1.5 text-xs text-slate-500">
                Si defines una clave, se utilizará para cifrar la clave maestra en disco. Puedes agregar <code class="text-amber-300/90 font-mono">SECURITY_KEY</code> en tu panel de Coolify para reinicios desatendidos en caliente.
              </p>
            </div>
          </div>
        </div>

        <!-- Submit Button -->
        <div class="pt-2">
          <button type="submit" id="btnSubmit" class="w-full bg-gradient-to-r from-clip-500 to-indigo-600 hover:from-clip-600 hover:to-indigo-700 text-white font-semibold py-3 px-4 rounded-xl shadow-lg hover:shadow-indigo-500/20 transition-all flex items-center justify-center space-x-2">
            <span id="btnSubmitText">Guardar y Finalizar Configuración</span>
            <svg id="btnSpinner" class="hidden w-5 h-5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </button>
        </div>

      </form>
    </div>

    <!-- Success Congratulations Modal / Card -->
    <div id="successCard" class="hidden bg-slate-900 border border-emerald-500/50 shadow-2xl rounded-2xl p-6 sm:p-8 backdrop-blur-sm text-center">
      <div class="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4 text-emerald-400">
        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h2 class="text-2xl font-bold text-slate-100 mb-2">¡Plugin Configurado Exitosamente!</h2>
      <p class="text-sm text-slate-300 max-w-md mx-auto mb-6">
        Las credenciales de Clip y los parámetros de PocketBase se guardaron de forma segura en la base de datos.
      </p>

      <div class="bg-slate-950 border border-slate-800 rounded-xl p-4 text-left mb-6">
        <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
          Webhook URL lista para registrar en Dashboard Clip:
        </label>
        <div class="flex items-center space-x-2">
          <input type="text" id="finalWebhookUrl" readonly class="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-emerald-300 focus:outline-none select-all" />
          <button type="button" id="btnCopyWebhook" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-lg transition whitespace-nowrap flex items-center space-x-1">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
            <span id="copyText">Copiar</span>
          </button>
        </div>
      </div>

      <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
        <a href="/_/" class="w-full sm:w-auto px-6 py-3 bg-slate-100 hover:bg-white text-slate-950 font-semibold rounded-xl transition shadow-lg flex items-center justify-center space-x-2">
          <span>Ir a PocketBase Admin UI</span>
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </a>
      </div>
    </div>

  </div>

  <footer class="mt-12 text-center text-xs text-slate-600">
    Clip PocketBase Plugin &bull; Integración Autónoma de Pagos
  </footer>

  <!-- Client-side Logic Script -->
  <script>
    (function () {
      // DOM Elements
      const setupForm = document.getElementById('setupForm');
      const formCard = document.getElementById('formCard');
      const alreadyConfiguredBanner = document.getElementById('alreadyConfiguredBanner');
      const alertBox = document.getElementById('alertBox');
      const successCard = document.getElementById('successCard');

      const identityInput = document.getElementById('identity');
      const passwordInput = document.getElementById('password');
      const clipApiKeyInput = document.getElementById('clipApiKey');
      const pocketbaseUrlInput = document.getElementById('pocketbaseUrl');
      const webhookSecretInput = document.getElementById('webhookSecret');
      const adminUserIdsInput = document.getElementById('adminUserIds');
      const securityKeyInput = document.getElementById('securityKey');
      const webhookPreview = document.getElementById('webhookPreview');

      const togglePasswordBtn = document.getElementById('togglePasswordBtn');
      const toggleApiKeyBtn = document.getElementById('toggleApiKeyBtn');
      const toggleSecurityKeyBtn = document.getElementById('toggleSecurityKeyBtn');
      const btnGenUuid = document.getElementById('btnGenUuid');
      const btnGenSecKey = document.getElementById('btnGenSecKey');
      const btnSubmit = document.getElementById('btnSubmit');
      const btnSubmitText = document.getElementById('btnSubmitText');
      const btnSpinner = document.getElementById('btnSpinner');
      const btnReconfigure = document.getElementById('btnReconfigure');
      const finalWebhookUrlInput = document.getElementById('finalWebhookUrl');
      const btnCopyWebhook = document.getElementById('btnCopyWebhook');
      const copyText = document.getElementById('copyText');

      // Helper: Show Alert
      function showAlert(message, type = 'error') {
        alertBox.classList.remove('hidden', 'bg-rose-950/80', 'border-rose-800', 'text-rose-200', 'bg-emerald-950/80', 'border-emerald-800', 'text-emerald-200');
        if (type === 'error') {
          alertBox.classList.add('bg-rose-950/80', 'border', 'border-rose-800', 'text-rose-200');
        } else {
          alertBox.classList.add('bg-emerald-950/80', 'border', 'border-emerald-800', 'text-emerald-200');
        }
        alertBox.textContent = message;
        alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      function hideAlert() {
        alertBox.classList.add('hidden');
      }

      // Update Webhook URL Preview
      function updateWebhookPreview() {
        let baseUrl = (pocketbaseUrlInput.value || window.location.origin).trim().replace(/\\/+$/, '');
        let secret = (webhookSecretInput.value || '').trim();
        let preview = \`\${baseUrl}/api/clip/webhook?token=\${encodeURIComponent(secret)}\`;
        webhookPreview.textContent = preview;
        return preview;
      }

      // Generate UUID4
      function generateUuid() {
        let uuid = '';
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
          uuid = crypto.randomUUID();
        } else {
          // Fallback UUID generation
          uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });
        }
        webhookSecretInput.value = uuid;
        updateWebhookPreview();
      }

      // Password visibility toggle helper
      function setupTogglePassword(inputEl, btnEl) {
        btnEl.addEventListener('click', () => {
          const type = inputEl.getAttribute('type') === 'password' ? 'text' : 'password';
          inputEl.setAttribute('type', type);
        });
      }

      setupTogglePassword(passwordInput, togglePasswordBtn);
      setupTogglePassword(clipApiKeyInput, toggleApiKeyBtn);
      if (toggleSecurityKeyBtn && securityKeyInput) {
        setupTogglePassword(securityKeyInput, toggleSecurityKeyBtn);
      }

      // Event Listeners for Preview Updates
      pocketbaseUrlInput.addEventListener('input', updateWebhookPreview);
      webhookSecretInput.addEventListener('input', updateWebhookPreview);
      btnGenUuid.addEventListener('click', generateUuid);
      if (btnGenSecKey && securityKeyInput) {
        btnGenSecKey.addEventListener('click', () => {
          let key = '';
          if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            key = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
          } else {
            key = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[x]/g, () => Math.floor(Math.random() * 16).toString(16));
          }
          securityKeyInput.value = key;
        });
      }

      // Reconfigure action
      if (btnReconfigure) {
        btnReconfigure.addEventListener('click', () => {
          formCard.classList.remove('hidden');
          alreadyConfiguredBanner.classList.add('hidden');
        });
      }

      // Copy Webhook URL to clipboard
      btnCopyWebhook.addEventListener('click', async () => {
        const text = finalWebhookUrlInput.value;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            finalWebhookUrlInput.select();
            document.execCommand('copy');
          }
          copyText.textContent = '¡Copiado!';
          btnCopyWebhook.classList.replace('bg-emerald-600', 'bg-slate-700');
          btnCopyWebhook.classList.replace('text-slate-950', 'text-emerald-400');
          setTimeout(() => {
            copyText.textContent = 'Copiar';
            btnCopyWebhook.classList.replace('bg-slate-700', 'bg-emerald-600');
            btnCopyWebhook.classList.replace('text-emerald-400', 'text-slate-950');
          }, 2500);
        } catch (err) {
          console.error('Failed to copy: ', err);
        }
      });

      // 1. Initial Load: Check setup status
      async function checkStatus() {
        // Set default pocketbase URL
        pocketbaseUrlInput.value = window.location.origin;
        generateUuid();

        try {
          const res = await fetch('/api/plugin/setup-status');
          if (res.ok) {
            const data = await res.json();
            if (data.pocketbase_url_suggestion) {
              pocketbaseUrlInput.value = data.pocketbase_url_suggestion;
              updateWebhookPreview();
            }
            if (data.is_configured) {
              alreadyConfiguredBanner.classList.remove('hidden');
              formCard.classList.add('hidden');
            }
          }
        } catch (err) {
          console.warn('Could not check setup status:', err);
        }
      }

      // 2. Form Submission Handler
      setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAlert();

        const identity = identityInput.value.trim();
        const password = passwordInput.value;
        const clip_api_key = clipApiKeyInput.value.trim();
        const pocketbase_url = pocketbaseUrlInput.value.trim();
        const clip_webhook_secret = webhookSecretInput.value.trim();
        const admin_user_ids = adminUserIdsInput.value.trim();
        const security_key = securityKeyInput ? securityKeyInput.value.trim() : "";

        if (!clip_api_key || clip_api_key.length < 20) {
          showAlert('La Clip API Key debe tener al menos 20 caracteres.');
          return;
        }

        // Disable button & show spinner
        btnSubmit.disabled = true;
        btnSubmitText.textContent = 'Configurando Plugin...';
        btnSpinner.classList.remove('hidden');

        try {
          const payload = {
            identity,
            password,
            clip_api_key,
            pocketbase_url,
            clip_webhook_secret,
            admin_user_ids,
            security_key
          };

          const response = await fetch('/api/plugin/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          const resData = await response.json().catch(() => ({}));

          if (!response.ok) {
            const errorMsg = resData.message || resData.error || \`Error \${response.status}: No se pudo guardar la configuración.\`;
            showAlert(errorMsg, 'error');
            btnSubmit.disabled = false;
            btnSubmitText.textContent = 'Guardar y Finalizar Configuración';
            btnSpinner.classList.add('hidden');
            return;
          }

          // Success Flow
          formCard.classList.add('hidden');
          alreadyConfiguredBanner.classList.add('hidden');
          finalWebhookUrlInput.value = updateWebhookPreview();
          successCard.classList.remove('hidden');
          successCard.scrollIntoView({ behavior: 'smooth', block: 'center' });

        } catch (err) {
          console.error('Setup submit error:', err);
          showAlert('Error de red o conexión al servidor. Inténtalo nuevamente.');
          btnSubmit.disabled = false;
          btnSubmitText.textContent = 'Guardar y Finalizar Configuración';
          btnSpinner.classList.add('hidden');
        }
      });

      // Run on page load
      checkStatus();
    })();
  </script>
</body>
</html>\`;

routerAdd("GET", "/api/plugin/setup-status", (e) => {
  var psh = require(\`\${__hooks}/plugin_settings_helper.js\`);
  var envHelper = require(\`\${__hooks}/env_helper.js\`);
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
    pocketbase_url_suggestion: pbUrl || "",
    vault_status: envHelper.getVaultStatus()
  });
});

routerAdd("GET", "/setup", (e) => {
  // Use PocketBase v0.23+ native fileFS API to serve setup.html
  try {
    return e.fileFS($os.dirFS("./pb_public"), "setup.html");
  } catch (_) {}

  // Fallback to embedded HTML if pb_public/setup.html is missing or inaccessible
  return e.html(200, SETUP_HTML_EMBEDDED);
});

routerAdd("POST", "/api/plugin/setup", (e) => {
  var info = e.requestInfo();
  var body = info.body || {};

  // ── Rate Limiting — protect superuser auth from brute force ──────────────
  var rl = require(\`\${__hooks}/rate_limiter.js\`);
  var clientIp = e.realIP ? e.realIP() : "unknown";
  var rlResult = rl.checkLimit("setup_auth:" + clientIp, 5, 900000); // 5 attempts / 15 min
  if (!rlResult.allowed) {
    throw new TooManyRequestsError("Too many setup attempts. Please wait 15 minutes before trying again.");
  }

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

    if (adminRecord && adminRecord.validatePassword(body.password.toString())) {
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

  // ── Max-length validation (DoS protection) ────────────────────────────
  if (clipApiKey.length > 500)        throw new BadRequestError("clip_api_key exceeds maximum allowed length.");
  if (pbUrl.length > 2000)            throw new BadRequestError("pocketbase_url exceeds maximum allowed length.");
  if (clipWebhookSecret.length > 256) throw new BadRequestError("clip_webhook_secret exceeds maximum allowed length.");
  if (adminUserIds.length > 2000)     throw new BadRequestError("admin_user_ids exceeds maximum allowed length.");

  // ── Unified Encrypted Storage Execution ──────────────────────────────
  var envHelper = require(\`\${__hooks}/env_helper.js\`);

  // Wrap master key if security_key / passphrase is provided
  var secKey = (body.security_key || body.passphrase || body.encryption_key || "").toString().trim();
  if (secKey.length > 512) throw new BadRequestError("security_key exceeds maximum allowed length.");
  if (secKey) {
    try {
      envHelper.wrapVault(secKey);
    } catch (wrapErr) {
      console.log("[SETUP ERROR] Failed to wrap vault with security key:", wrapErr.message);
    }
  }

  envHelper.setEnv("clip_api_key", clipApiKey, true);
  envHelper.setEnv("pocketbase_url", pbUrl, true);
  if (clipWebhookSecret) {
    envHelper.setEnv("clip_webhook_secret", clipWebhookSecret, true);
  }
  if (body.admin_user_ids !== undefined) {
    envHelper.setEnv("admin_user_ids", adminUserIds, false);
  }
  envHelper.setEnv("is_configured", "true", false);

  // ── Delete Legacy plugin_settings Collection if Present ────────────────
  try {
    var legacyCol = $app.findCollectionByNameOrId("plugin_settings");
    if (legacyCol) {
      $app.delete(legacyCol);
    }
  } catch (_) {}

  var currentVaultStatus = envHelper.getVaultStatus();

  return e.json(200, {
    success: true,
    message: "Plugin configuration completed successfully.",
    can_encrypt: true,
    vault_status: currentVaultStatus
  });
});
