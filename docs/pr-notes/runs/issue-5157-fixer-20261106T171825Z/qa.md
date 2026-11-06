# QA — Issue #5157

> The requested `allplays-qa-expert` skill was unavailable; this analysis follows the repository guidance and issue contract.

## Prevention-oriented regressions

The service test must prove UID/email delegation, unchanged cursor forwarding, preserved application order, and retention of `nextCursor`, `retryCursor`, `hasMore`, and partial errors. An unauthenticated call must not issue an unscoped query.

The component test must cover independent loading/empty/error states, all seven status labels, required fields and optional selected option, closed-form visibility, unchanged published-form actions, Load more appending, Retry retaining successful cards, no mutation controls, and auth/refresh reset.

Keep `tests/unit/parent-dashboard-registration-applications.test.js` green as the authoritative query, security, index, ordering, deduplication, and enrichment contract.

## Focused validation

Run the focused app service/component tests, the legacy history unit test, app typecheck/build, and only the existing focused registration public smoke path.

## Recurrence risk

**Medium.** The app bridges a flexible legacy payload through an `any`-heavy adapter, so complete service contract coverage is required to prevent silent cursor or partial-error loss.
