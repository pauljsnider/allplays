# Risk Matrix

- **High:** targeted content disclosure, duplicate chat documents, incomplete audit links, duplicate notifications, unauthorized side effects.
- **Medium:** opt-out regression, incorrect success reporting, malformed chat schema or text.
- **Low:** checkbox reset behavior across reopen/team changes.

# Automated Tests To Add/Update

- Component: default checked control, enabled payload/result, opt-out, hidden selected-member control, forced email-only payload.
- Service: propagate booleans and normalize non-full-team requests to false.
- Adapter: callable payload transports the flag without changing `js/db.js`.
- Callable: exactly one linked chat record, reciprocal IDs, subject/body text, no chat when false/absent/targeted, no duplicate email inbox writes, unchanged email-only behavior.

# Manual Test Plan

Verify one enabled full-team send, one opt-out send, and one selected-member send as coach/admin; then verify parent chat visibility, normal chat notification, no duplicate email inbox record, and reciprocal Firestore IDs.

# Negative Tests

Unauthorized caller, invalid content, no recipients, crafted targeted flag, repeated recipients, non-boolean truthy flag, and initial write failure must create no unintended chat artifact.

# Release Gates

- `npm --prefix apps/app test -- --run apps/app/src/pages/messages/components/TeamEmailSheet.test.tsx`
- focused app service/adapter tests
- `npm run test:functions:team-email`
- Function notification/auth-email loader suites required by repository policy when `functions/index.js` changes.

# Post-Deploy Checks

Confirm 1:1 cross-post requests to chat documents, reciprocal IDs, expected mail-job count, zero direct team-email inbox records for cross-posts, and zero chat documents for opt-out/targeted sends.
