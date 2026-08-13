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

    <div id="alertBox" role="alert" class="hidden mb-6 rounded-xl p-4 text-sm font-medium transition-all"></div>

    <div id="formCard" class="bg-slate-900/80 border border-slate-800 shadow-2xl rounded-2xl p-6 sm:p-8 backdrop-blur-sm">
      <form id="setupForm" class="space-y-6">
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

        <div>
          <div class="flex items-center space-x-2 border-b border-slate-800 pb-3 mb-4">
            <svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <h2 class="text-base font-semibold text-slate-200">Seguridad y Cifrado</h2>
          </div>

          <div class="space-y-4">
            <div>
              <label class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                ENCRYPTION_KEY (Clave Maestra de Cifrado)
              </label>

              <!-- Shown when has_encryption_key === true -->
              <div id="encKeyServerNotice" class="hidden p-4 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-xs text-emerald-300 font-medium space-y-1">
                <div class="flex items-center space-x-2 font-bold text-emerald-400 text-sm">
                  <span>✓ Configurada en el entorno del servidor</span>
                </div>
                <p class="text-slate-300">Las credenciales de Clip y SPEI se cifrarán automáticamente en reposo.</p>
              </div>

              <!-- Shown when has_encryption_key === false -->
              <div id="encKeyFormContainer" class="space-y-3">
                <div class="p-3.5 bg-amber-950/50 border border-amber-500/40 rounded-xl text-xs text-amber-300 space-y-1">
                  <div class="font-bold text-amber-400">⚠️ No se detectó ENCRYPTION_KEY en el servidor</div>
                  <p class="text-slate-300">
                    El wizard generará una clave segura. <strong class="text-amber-300 font-semibold">DEBES copiarla y configurarla como variable de entorno antes de reiniciar PocketBase.</strong>
                  </p>
                </div>

                <div class="flex space-x-2">
                  <input type="text" id="encryptionKey" placeholder="Genera o escribe una clave de al menos 32 caracteres"
                    class="flex-1 bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition font-mono">
                  <button type="button" id="btnCopyKey" class="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition flex items-center whitespace-nowrap">
                    <span id="copyKeyText">📋 Copiar</span>
                  </button>
                </div>

                <div class="flex items-center justify-between">
                  <button type="button" id="btnGenEncKey" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition flex items-center whitespace-nowrap">
                    🔑 Generar clave segura
                  </button>
                </div>

                <div class="flex items-start space-x-2.5 pt-1">
                  <input type="checkbox" id="confirmKeyCopied" class="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-emerald-500 cursor-pointer">
                  <label for="confirmKeyCopied" class="text-xs text-slate-300 select-none cursor-pointer">
                    Confirmé que copié y guardé la ENCRYPTION_KEY en un lugar seguro
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div class="flex items-center space-x-2 border-b border-slate-800 pb-3 mb-4">
            <svg class="w-5 h-5 text-clip-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            <h2 class="text-base font-semibold text-slate-200">Credenciales de Clip México</h2>
          </div>

          <div class="space-y-4">
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

            <div>
              <label for="pocketbaseUrl" class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                PocketBase URL pública <span class="text-rose-400">*</span>
              </label>
              <input type="url" id="pocketbaseUrl" required placeholder="https://tu-dominio.com"
                class="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition font-mono">
              <p class="mt-1 text-xs text-slate-500">URL base donde se encuentra escuchando PocketBase.</p>
            </div>

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

            <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5">
              <div class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Vista Previa de URL de Webhook:</div>
              <div id="webhookPreview" class="text-xs font-mono text-indigo-300 break-all select-all">
                https://...
              </div>
            </div>

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
          </div>
        </div>

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
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
            <span id="copyText">Copiar</span>
          </button>
        </div>
      </div>

      <div id="encryptionNoticeBox" class="hidden bg-amber-950/40 border border-amber-500/40 rounded-xl p-4 text-left mb-6">
        <div class="flex items-start space-x-3">
          <svg class="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div class="flex-1">
            <h4 class="text-xs font-bold text-amber-300 uppercase tracking-wider mb-1">Configuración Requerida de ENCRYPTION_KEY</h4>
            <p class="text-xs text-slate-300 mb-2">
              Configura esta clave como variable de entorno en tu servidor/Docker/Coolify para habilitar el cifrado seguro:
            </p>
            <div class="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs font-mono text-amber-200 break-all select-all flex items-center justify-between">
              <span id="envVarCode">ENCRYPTION_KEY=...</span>
            </div>
          </div>
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

  <script>
    (function () {
      const setupForm = document.getElementById('setupForm');
      const formCard = document.getElementById('formCard');
      const alreadyConfiguredBanner = document.getElementById('alreadyConfiguredBanner');
      const alertBox = document.getElementById('alertBox');
      const successCard = document.getElementById('successCard');

      const identityInput = document.getElementById('identity');
      const passwordInput = document.getElementById('password');
      const encryptionKeyInput = document.getElementById('encryptionKey');
      const clipApiKeyInput = document.getElementById('clipApiKey');
      const pocketbaseUrlInput = document.getElementById('pocketbaseUrl');
      const webhookSecretInput = document.getElementById('webhookSecret');
      const adminUserIdsInput = document.getElementById('adminUserIds');
      const webhookPreview = document.getElementById('webhookPreview');

      const togglePasswordBtn = document.getElementById('togglePasswordBtn');
      const toggleApiKeyBtn = document.getElementById('toggleApiKeyBtn');
      const btnGenEncKey = document.getElementById('btnGenEncKey');
      const btnGenUuid = document.getElementById('btnGenUuid');
      const btnSubmit = document.getElementById('btnSubmit');
      const btnSubmitText = document.getElementById('btnSubmitText');
      const btnSpinner = document.getElementById('btnSpinner');
      const btnReconfigure = document.getElementById('btnReconfigure');
      const finalWebhookUrlInput = document.getElementById('finalWebhookUrl');
      const btnCopyWebhook = document.getElementById('btnCopyWebhook');
      const copyText = document.getElementById('copyText');
      const encryptionNoticeBox = document.getElementById('encryptionNoticeBox');
      const envVarCode = document.getElementById('envVarCode');

      const encKeyServerNotice = document.getElementById('encKeyServerNotice');
      const encKeyFormContainer = document.getElementById('encKeyFormContainer');
      const btnCopyKey = document.getElementById('btnCopyKey');
      const copyKeyText = document.getElementById('copyKeyText');
      const confirmKeyCopied = document.getElementById('confirmKeyCopied');

      let hasServerKey = false;

      function updateSubmitButtonState() {
        if (hasServerKey) {
          btnSubmit.disabled = false;
          btnSubmit.classList.remove('opacity-50', 'cursor-not-allowed');
        } else {
          const isChecked = confirmKeyCopied ? confirmKeyCopied.checked : false;
          const keyVal = encryptionKeyInput ? encryptionKeyInput.value.trim() : '';
          const isValidKey = keyVal.length >= 32;
          btnSubmit.disabled = !(isChecked && isValidKey);
          if (btnSubmit.disabled) {
            btnSubmit.classList.add('opacity-50', 'cursor-not-allowed');
          } else {
            btnSubmit.classList.remove('opacity-50', 'cursor-not-allowed');
          }
        }
      }

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

      function updateWebhookPreview() {
        let baseUrl = (pocketbaseUrlInput.value || window.location.origin).trim().replace(/\/+$/, '');
        let secret = (webhookSecretInput.value || '').trim();
        let preview = baseUrl + '/api/clip/webhook?token=' + encodeURIComponent(secret);
        webhookPreview.textContent = preview;
        return preview;
      }

      function generateUuid() {
        let uuid = '';
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
          uuid = crypto.randomUUID();
        } else {
          uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });
        }
        webhookSecretInput.value = uuid;
        updateWebhookPreview();
      }

      function setupTogglePassword(inputEl, btnEl) {
        btnEl.addEventListener('click', () => {
          const type = inputEl.getAttribute('type') === 'password' ? 'text' : 'password';
          inputEl.setAttribute('type', type);
        });
      }

      setupTogglePassword(passwordInput, togglePasswordBtn);
      setupTogglePassword(clipApiKeyInput, toggleApiKeyBtn);

      function generateEncryptionKey() {
        let chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let key = '';
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
          let bytes = new Uint8Array(32);
          crypto.getRandomValues(bytes);
          for (let i = 0; i < 32; i++) {
            key += chars[bytes[i] % chars.length];
          }
        } else {
          for (let i = 0; i < 32; i++) {
            key += chars.charAt(Math.floor(Math.random() * chars.length));
          }
        }
        if (encryptionKeyInput) {
          encryptionKeyInput.value = key;
        }
        updateSubmitButtonState();
      }

      if (btnGenEncKey) {
        btnGenEncKey.addEventListener('click', generateEncryptionKey);
      }

      if (btnCopyKey) {
        btnCopyKey.addEventListener('click', async () => {
          const text = encryptionKeyInput ? encryptionKeyInput.value : '';
          if (!text) return;
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(text);
            } else {
              encryptionKeyInput.select();
              document.execCommand('copy');
            }
            if (copyKeyText) copyKeyText.textContent = '¡Copiado!';
            setTimeout(() => {
              if (copyKeyText) copyKeyText.textContent = '📋 Copiar';
            }, 2500);
          } catch (err) {
            console.error('Failed to copy key: ', err);
          }
        });
      }

      if (confirmKeyCopied) {
        confirmKeyCopied.addEventListener('change', updateSubmitButtonState);
      }

      if (encryptionKeyInput) {
        encryptionKeyInput.addEventListener('input', updateSubmitButtonState);
      }

      pocketbaseUrlInput.addEventListener('input', updateWebhookPreview);
      webhookSecretInput.addEventListener('input', updateWebhookPreview);
      btnGenUuid.addEventListener('click', generateUuid);

      if (btnReconfigure) {
        btnReconfigure.addEventListener('click', () => {
          formCard.classList.remove('hidden');
          alreadyConfiguredBanner.classList.add('hidden');
        });
      }

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

      async function checkStatus() {
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

            hasServerKey = Boolean(data.has_encryption_key);
            if (hasServerKey) {
              if (encKeyServerNotice) encKeyServerNotice.classList.remove('hidden');
              if (encKeyFormContainer) encKeyFormContainer.classList.add('hidden');
            } else {
              if (encKeyServerNotice) encKeyServerNotice.classList.add('hidden');
              if (encKeyFormContainer) encKeyFormContainer.classList.remove('hidden');
              if (encryptionKeyInput && (!encryptionKeyInput.value || encryptionKeyInput.value.length < 32)) {
                generateEncryptionKey();
              }
            }
            updateSubmitButtonState();

            if (data.is_configured) {
              alreadyConfiguredBanner.classList.remove('hidden');
              formCard.classList.add('hidden');
            }
          }
        } catch (err) {
          console.warn('Could not check setup status:', err);
        }
      }

      setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAlert();

        const identity = identityInput.value.trim();
        const password = passwordInput.value;
        const encryption_key = encryptionKeyInput ? encryptionKeyInput.value.trim() : "";
        const clip_api_key = clipApiKeyInput.value.trim();
        const pocketbase_url = pocketbaseUrlInput.value.trim();
        const clip_webhook_secret = webhookSecretInput.value.trim();
        const admin_user_ids = adminUserIdsInput.value.trim();

        if (!hasServerKey) {
          if (!encryption_key || encryption_key.length < 32) {
            showAlert('La ENCRYPTION_KEY es obligatoria y debe tener al menos 32 caracteres.');
            return;
          }
          if (!confirmKeyCopied || !confirmKeyCopied.checked) {
            showAlert('Debes confirmar que copiaste y guardaste la ENCRYPTION_KEY en un lugar seguro.');
            return;
          }
        }

        if (!clip_api_key || clip_api_key.length < 20) {
          showAlert('La Clip API Key debe tener al menos 20 caracteres.');
          return;
        }

        btnSubmit.disabled = true;
        btnSubmitText.textContent = 'Configurando Plugin...';
        btnSpinner.classList.remove('hidden');

        try {
          const payload = {
            identity,
            password,
            encryption_key,
            clip_api_key,
            pocketbase_url,
            clip_webhook_secret,
            admin_user_ids
          };

          const response = await fetch('/api/plugin/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          const resData = await response.json().catch(() => ({}));

          if (!response.ok) {
            const errorMsg = resData.message || resData.error || ('Error ' + response.status + ': No se pudo guardar la configuración.');
            showAlert(errorMsg, 'error');
            btnSubmit.disabled = false;
            btnSubmitText.textContent = 'Guardar y Finalizar Configuración';
            btnSpinner.classList.add('hidden');
            updateSubmitButtonState();
            return;
          }

          formCard.classList.add('hidden');
          alreadyConfiguredBanner.classList.add('hidden');
          finalWebhookUrlInput.value = updateWebhookPreview();

          if (resData.requires_env_setup) {
            const keyToShow = encryption_key;
            if (keyToShow && encryptionNoticeBox && envVarCode) {
              envVarCode.textContent = 'ENCRYPTION_KEY=' + keyToShow;
              encryptionNoticeBox.classList.remove('hidden');
            }
          } else if (encryptionNoticeBox) {
            encryptionNoticeBox.classList.add('hidden');
          }

          successCard.classList.remove('hidden');
          successCard.scrollIntoView({ behavior: 'smooth', block: 'center' });

        } catch (err) {
          console.error('Setup submit error:', err);
          showAlert('Error de red o conexión al servidor. Inténtalo nuevamente.');
          btnSubmit.disabled = false;
          btnSubmitText.textContent = 'Guardar y Finalizar Configuración';
          btnSpinner.classList.add('hidden');
          updateSubmitButtonState();
        }
      });

      checkStatus();
    })();
  </script>
</body>
</html>`;

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
    pocketbase_url_suggestion: pbUrl || "",
    has_encryption_key: ($os.getenv("ENCRYPTION_KEY") || "").length >= 32
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
  var rl = require(`${__hooks}/rate_limiter.js`);
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

  // Read encryption key: from $os.getenv first, then from form body
  var serverEncKey = $os.getenv("ENCRYPTION_KEY") || "";
  var formEncKey = (body.encryption_key || "").toString().trim();
  var effectiveEncKey = serverEncKey.length >= 32 ? serverEncKey : formEncKey;

  if (!effectiveEncKey || effectiveEncKey.length < 32) {
    throw new BadRequestError(
      "ENCRYPTION_KEY is required and must be at least 32 characters. " +
      "Generate one using the wizard or set ENCRYPTION_KEY in your environment."
    );
  }

  var usingServerKey = serverEncKey.length >= 32;
  var usingFormKey = !usingServerKey && formEncKey.length >= 32;

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
  if (formEncKey.length > 512)        throw new BadRequestError("encryption_key exceeds maximum allowed length.");

  // ── Encrypted Storage Execution ─────────────────────────────────────────
  var envHelper = require(`${__hooks}/env_helper.js`);
  if (usingFormKey) {
    try {
      var keyPath = `${$app.dataDir()}/.encryption_key`;
      $os.writeFile(keyPath, effectiveEncKey, 0o600);
    } catch (_) {}
  }

  envHelper.setEnv("clip_api_key", clipApiKey, true);
  envHelper.setEnv("pocketbase_url", pbUrl, true);
  if (clipWebhookSecret) {
    envHelper.setEnv("clip_webhook_secret", clipWebhookSecret, true);
  }

  // ── Delete Legacy Sensitive Records from plugin_settings ────────────────
  var sensitiveKeys = ["clip_api_key", "pocketbase_url", "clip_webhook_secret"];
  for (var i = 0; i < sensitiveKeys.length; i++) {
    try {
      var legacyRec = $app.findFirstRecordByFilter("plugin_settings", "key = {:key}", { key: sensitiveKeys[i] });
      if (legacyRec) {
        $app.delete(legacyRec);
      }
    } catch (_) {}
  }

  // ── Upsert Non-Sensitive Settings in plugin_settings ────────────────────
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

  if (body.admin_user_ids !== undefined) {
    upsertSetting("admin_user_ids", adminUserIds);
  }
  upsertSetting("is_configured", "true");

  return e.json(200, {
    success: true,
    message: "Plugin configuration completed successfully.",
    can_encrypt: true,
    requires_env_setup: usingFormKey
    // NOTE: encryption_key is intentionally NOT returned — it stays client-side only
  });
});
