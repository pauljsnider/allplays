# Architecture analysis

## Existing flow

`team-media.js` owns both legacy upload forms and delegates each selected file
to `uploadSelectedFiles`. That helper already requests a range when
`reserveOrders` is true, forwards each defined indexed value (including `0`),
and omits `order` when no value exists. `uploadTeamMediaFile` already validates
and persists a supplied order and deletes the uploaded Storage object if the
metadata write fails.

## Minimal decision

Enable `reserveOrders` only in the legacy document form call, matching the
established photo-form integration. Do not alter the shared helper, database
uploader, reservation primitive, or any cache-critical import.

## Invariants

- Validation and batch limits remain before upload work.
- Files continue to upload sequentially with independent progress and failure
  reporting.
- Undefined assigned values remain absent from uploader options.
- Metadata failures continue through `uploadTeamMediaFile` cleanup.
- No import surface changes, so smoke-test module stubs need no updates.
