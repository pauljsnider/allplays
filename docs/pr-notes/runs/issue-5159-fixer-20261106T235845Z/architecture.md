# Architecture analysis

Keep `js/db.js` as the sole owner of identity queries, deduplication, sorting, pagination, enrichment, and partial-error behavior. Add one dynamic compatibility export to `legacyParentTools.ts`, matching its existing `callLegacyDb` pattern.

Define app-facing structural types in `parentRegistrationsService.ts` and add a loader that validates authentication, builds the legacy identity profile from UID plus verified email, delegates once, and returns the legacy page unchanged. Cursor document snapshots remain opaque `unknown` values because the service must forward rather than interpret them.

This avoids duplicating Firestore behavior and keeps the future UI dependent only on the focused service boundary.
