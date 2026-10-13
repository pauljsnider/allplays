# Architecture analysis

## Current flow

The legacy form calls `uploadSelectedFiles`, which owns per-file validation,
progress UI, uploader invocation, refresh, and summary reporting. Its
`reserveOrders` flag both calls `reserveTeamMediaOrderRange` and controls
whether an order enters the uploader options. The lower-level
`uploadTeamMediaFile` contract already persists explicit orders, reserves a
single order when absent, and cleans the uploaded object on downstream failure.

## Decision

Decouple provided order values from reservation acquisition. Add an optional
`assignedOrders` input to `uploadSelectedFiles`, preserve the existing photo
reservation branch, and include an indexed order only when it is not
`undefined`. This preserves valid order `0` and omits the property for the
legacy fallback path.

Export the existing helper as the smallest focused test seam. Do not invent DOM
order storage, enable document range reservation, duplicate DB validation, or
alter the upload pipeline. No imports, cache-critical modules, or smoke stubs
need to change.

## Invariants

- Preserve validation before uploader invocation.
- Preserve sequential processing, progress callbacks, partial-success counts,
  library refresh, and user-visible failure reporting.
- Preserve photo range reservation and no-order document behavior unchanged.
- Preserve Storage cleanup after metadata-write failure.
