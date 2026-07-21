# ADR 0003: Business extension via native hook on clip_orders

## Context
The plugin must not know the business logic (activate product, etc.), but the host needs to react to payment status changes.

## Decision
We use `onRecordAfterUpdateSuccess(..., "clip_orders")` in a separate file (`my_app_clip_handler.pb.js`), never edited by the plugin.

## Consequences
- No new infrastructure introduced (no internal webhooks or custom events).
- The file `clip_00_bootstrap.pb.js` logs the exact path in the console on boot so developers never forget it.
- If the host doesn't create the handler file, nothing happens after payment — a silent failure mitigated by the console boot message.
