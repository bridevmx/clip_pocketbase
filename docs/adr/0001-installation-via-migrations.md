# ADR 0001: Installation via pb_migrations, not manual schema import

## Context
The reference repository (pocketbase_stripe) required importing a `pb_schema.json` manually from the Admin UI. This contradicts the "upload and automatic run" requirement.

## Decision
The collections `clip_orders` and `clip_payments` are created via `pb_migrations/*.js`, which PocketBase runs automatically at startup.

## Consequences
- Zero manual steps in the Admin UI.
- Versionable in Git, consistent with the user's workflow.
- Requires discipline: never edit collections manually or future migrations might desync.
