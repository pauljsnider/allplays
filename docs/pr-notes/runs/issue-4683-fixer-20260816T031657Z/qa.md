# QA Plan

## High-Risk Invariants

- No cross-organization or malformed record exposure.
- Canonical source selection is independent of input order.
- Source-only cancellation cannot produce a success message.
- Notification failure cannot produce a success message.

## Automated Coverage

- Unit: source selection, duplicate record and shared-ID handling, Timestamp/date normalization, deterministic date sorting, organization filtering, cancelled and incomplete states, invalid reciprocal links, past filtering.
- Source contract: bounded reads, safe DOM construction, cancellation-helper reuse, exact-record verification, retryable errors, and refresh calls after all mutation paths.
- Playwright: one row from two reciprocal records, confirmation decline and accept, canonical cancellation call, two notification targets, refreshed cancelled state, and no second cancellation.

## Release Gates

- `npx vitest run tests/unit/organization-schedule.test.js --reporter=verbose`
- `npx playwright test tests/smoke/organization-schedule.spec.js --config=playwright.smoke.config.js --reporter=line`
- `node scripts/check-critical-cache-bust.mjs`

## Residual Coverage Gap

The focused browser test proves UI orchestration and helper invocation. Existing Functions tests remain the backend evidence for push and inbox delivery.
