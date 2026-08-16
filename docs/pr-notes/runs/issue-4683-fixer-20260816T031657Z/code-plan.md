# Code Plan

## Patch Plan

1. Add `buildOrganizationPublishedMatchups` to normalize and validate reciprocal organization records.
2. Add Published Matchups loading, rendering, complete-state preservation, and cancellation wiring to `organization-schedule.html`.
3. Verify cancellation by reloading the exact source and counterpart before the existing helper posts notifications.
4. Refresh the list after single publish, CSV import, draft publication, and cancellation.
5. Add focused unit/source-contract tests and a dedicated Playwright smoke test.
6. Bump only the `organization-schedule.js` page cache key. Do not touch cache-critical shared modules.

## Root Cause

Creation workflows shipped without an organization-level canonical read model or cancellation surface. The existing reciprocal update path also swallows mirror-sync errors, so callers need authoritative verification before reporting success.

## Rollback

Revert the page section, helper export, and tests. No data migration or backend rollback is required.

## Commit Message

`Add organization matchup review and cancellation (#4683)`
