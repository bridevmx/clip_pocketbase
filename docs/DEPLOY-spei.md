# SPEI/CEP Plugin - Deploy Guide

## Quick Deploy to Easypanel

### Option 1: Manual Docker Build (Recommended)

1. **Clone the repo on your server:**
   ```bash
   git clone https://github.com/bridevmx/clip_pocketbase.git
   cd clip_pocketbase
   ```

2. **Build the Docker image:**
   ```bash
   docker build -t ghcr.io/bridevmx/clip-pocketbase:latest .
   ```

3. **Push to GitHub Container Registry:**
   ```bash
   echo "YOUR_GITHUB_TOKEN" | docker login ghcr.io -u bridevmx --password-stdin
   docker push ghcr.io/bridevmx/clip-pocketbase:latest
   ```

4. **Update Easypanel service:**
   - Go to your Easypanel dashboard
   - Find the `apps-clip-ify-pocketbase` service
   - Update the image to `ghcr.io/bridevmx/clip-pocketbase:latest`
   - Redeploy

### Option 2: Direct File Copy

If you already have PocketBase running on Easypanel:

1. **Copy plugin files to the server:**
   ```bash
   # Copy these directories to your PocketBase instance:
   pb_hooks/spei_*.js
   pb_migrations/1721500003_spei_collections.js
   pb_migrations/1721500004_spei_banks_data.js
   pb_public/spei-cep-form.html
   ```

2. **Restart PocketBase** - migrations run automatically on startup

## Environment Variables

Ensure these are set in Easypanel:

| Variable | Value | Notes |
|----------|-------|-------|
| `CLIP_API_KEY` | Your Clip API token | Pre-encoded Base64 |
| `POCKETBASE_URL` | Your public PocketBase URL | Must be publicly accessible |
| `BANXICO_TOKEN` | Your Banxico API token | Required for CEP validation |

## Post-Deploy Verification

1. **Check logs for bootstrap messages:**
   ```
   [SPEI PLUGIN] ─────────────────────────────────────────
   [SPEI PLUGIN] Loaded successfully.
   [SPEI PLUGIN] Expected collections: spei_settings, spei_orders, cep_verifications, spei_banks
   [SPEI PLUGIN] Active routes: POST /api/spei/create-order, POST /api/spei/report-payment, ...
   [SPEI PLUGIN] ─────────────────────────────────────────
   ```

2. **Test endpoints:**
   ```bash
   # Create a test order
   curl -X POST https://your-pocketbase.com/api/spei/create-order \
     -H "Content-Type: application/json" \
     -d '{"amount": 100.00, "reference_collection": "test", "reference_id": "TEST001"}'

   # Check status
   curl https://your-pocketbase.com/api/spei/order/{order_id}/status
   ```

3. **Verify bank catalog:**
   - Go to PocketBase Admin → Collections → spei_banks
   - Should contain ~100 Mexican banks

## Troubleshooting

### Migrations not running
- Check PocketBase logs for errors
- Ensure `pb_migrations/` directory is writable

### CEP validation failing
- Verify `BANXICO_TOKEN` is set correctly
- Check if Banxico API is accessible from your server
- Review logs for `[SPEI CEP]` messages

### Form not loading
- Ensure `pb_public/spei-cep-form.html` exists
- Check that PocketBase is serving static files from `pb_public/`
