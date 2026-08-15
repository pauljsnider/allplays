# Uniform Ordering and Fulfillment

Status: Proposed

Depends on: [Registration and financial operations](./07-registration-financial-operations.md)

## Objective

Centralize uniform selection, customization, payment, order aggregation, and fulfillment so organizations and families share one accurate order lifecycle.

## Requirements

1. Administrators can define season-specific catalogs, items, variants, size guides, required items, customization fields, deadlines, and fulfillment methods.
2. Families can select options per registered participant and review the exact spelling, size, quantity, and cost before confirmation.
3. Customization constraints support allowed characters, length, uniqueness rules, reserved values, and administrator review.
4. Orders reference immutable catalog and registration snapshots so later catalog edits do not alter confirmed purchases.
5. Charges, payments, credits, and refunds use the shared financial ledger rather than a separate balance system.
6. Administrators can group confirmed items into vendor-ready batches, lock a batch, export it, and track acknowledgement without exposing unrelated family data.
7. Changes after cutoff or batch lock use explicit amendment, exchange, or refund workflows with audit history.
8. Fulfillment supports bulk delivery, direct delivery, pickup windows, partial fulfillment, backorders, and lost-item replacement.
9. Family-facing status distinguishes selection required, payment pending, confirmed, ordered, ready, fulfilled, backordered, cancelled, and refunded.
10. Size and customization details are limited to authorized family and operations roles and follow retention policy.
11. Notifications are idempotent and tied to durable lifecycle transitions.
12. Imports and exports validate row identity, schema version, and duplicate processing.

## Design

### Catalog and order model

Use versioned catalogs containing items, variants, requirements, and validation rules. An order contains per-participant lines that snapshot the chosen variant and customization. Financial references point to the common ledger; sensitive delivery data remains in restricted records.

### Batch and fulfillment flow

A server operation selects eligible confirmed lines into a draft batch. Locking the batch freezes its contents and emits a versioned export. Importing vendor status is idempotent and produces line-level exceptions for operator review. Fulfillment events append history rather than replacing prior state.

### Experience

Place selection within the registration follow-up flow and expose outstanding actions in the family dashboard. Administrator views prioritize missing selections, validation issues, cutoff risk, batch readiness, and fulfillment exceptions.

## Tasks

- [ ] Define catalog, item, variant, requirement, order line, batch, export, and fulfillment schemas.
- [ ] Implement catalog validation, publication, archival, and season copy.
- [ ] Implement family selection, confirmation, amendment, exchange, and cancellation operations.
- [ ] Integrate order charges and refunds with the shared financial ledger.
- [ ] Build batch creation, lock, export, import, and exception-resolution tools.
- [ ] Build family web/mobile selection, size guidance, status, and pickup experiences.
- [ ] Add privacy rules and minimize data included in vendor exports.
- [ ] Add cutoff, duplicate import, concurrent batch, partial fulfillment, and refund tests.
- [ ] Add audit records, fulfillment metrics, and operator recovery guidance.
