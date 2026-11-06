# Architecture — Issue #5157

> The requested `allplays-architecture-expert` skill was unavailable; this analysis follows the repository guidance and existing contracts.

## Existing contract

`js/db.js` already implements `listParentRegistrationApplicationsPage`: normalized guardian-email and `id || uid` matching, cross-query deduplication, newest-first ordering, enrichment, normalized labels, pagination, retry cursors, and partial errors.

The normalized application has `id`, `registrationKey`, `teamId`, `formId`, `teamName`, `programName`, `playerName`, `guardianEmail`, `status`, `statusLabel`, `selectedOptionLabel`, and `submittedAt`. The page has `applications`, `nextCursor`, `retryCursor`, `hasMore`, and `errors`.

## Minimal integration

- Add a dynamic `callLegacyDb` export in the adapter.
- Add explicit service models and a loader that passes authenticated UID/email plus `{ cursor }`, preserving every page field and application order.
- Keep published-form and submitted-history state independent.
- Replace history on page-one refresh; append/deduplicate by `registrationKey` on load-more or retry.
- Render successful cards alongside partial errors; use `retryCursor` for Retry and `nextCursor` for Load more.
- Keep history read-only and independent of currently published forms.

## Risks

Narrowing the page loses cursor and partial-error resilience. Shared state can suppress one section when the other fails. Retried identity branches may repeat records. Passing linked teams instead of authenticated UID/email breaks identity matching. No rules, indexes, legacy query, or cache-bust changes are needed.
