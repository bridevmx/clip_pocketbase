# ADR 0002: Generic reference by text instead of typed relation

## Context
The plugin must work across multiple user SaaS applications (e-commerce, transport, bakery), each with a different "purchased item" model.

## Decision
`clip_orders` uses `reference_collection` (text) + `reference_id` (text) instead of a typed PocketBase relation to a `products` collection.

## Consequences
- The plugin never depends on specific host collections.
- Referential integrity is not validated at the DB level; it is handled by the business handler.
- Total portability across projects.
