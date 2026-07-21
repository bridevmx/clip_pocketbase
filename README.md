# pocketbase-clip-mx

A portable PocketBase plugin to integrate payments via Clip México payment links (Checkout API).

## Installation

1. Copy `pb_hooks/` files to your PocketBase `pb_hooks/` directory.
2. Copy `pb_migrations/` files to your PocketBase `pb_migrations/` directory.
3. Configure environment variables.
4. Restart PocketBase.

## Configuration

Required environment variables:
- `CLIP_API_KEY`: Your Clip checkout API key.
- `POCKETBASE_URL`: Your PocketBase application public URL (e.g. `https://my-app.com`).
