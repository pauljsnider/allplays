# Architecture analysis

## Current flow

The legacy form calls `uploadSelectedFiles`, which performs validation,
progress UI, uploader invocation, refresh, and summary reporting. Its
`reserveOrders` flag both calls `reserveTeamMediaOrderRange` and controls
whether an order enters the uploader options. The document form does not set
that flag. The lower-level `uploadTeamMediaFile` contract already handles
explicit and absent orders correctly and cleans the uploaded object from its
catch path.

## Decision

Decouple provided order values from reservation acquisition. Add an optional
`assignedOrders` input to `uploadSelectedFiles`, preserve the existing photo
reservation branch, and include an indexed order only when it is not
`undefined`. This preserves valid order `0` and omits the property for the
legacy fallback path.

Expose the existing helper as the smallest focused test seam. Do not invent
DOM order storage, enable document range reservation, duplicate DB validation,
or alter the upload pipeline.

No imports, cache-critical modules, or smoke stubs need to change.
