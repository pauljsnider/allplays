# Architecture analysis

The named `allplays-architecture-expert` skill was unavailable, so the role used the issue contract and repository evidence.

## Boundary

Dependency #5159 already provides `loadParentRegistrationApplicationsPage(user, { cursor })` with typed applications, cursors, partial errors, and normalized labels. `RegistrationsTool` must consume that focused boundary and must not import legacy DB code.

## State model

Keep published forms unchanged and add independent history state for accumulated applications, next cursor, retry cursor, partial errors, and application loading/error state. Application failures must not hide published forms, and form failures must not erase application history.

## Merge and retry

- Merge by `registrationKey` with an ID fallback; incoming records replace duplicates.
- Sort by `submittedAt` descending with a stable key tie-breaker.
- Retry the request cursor returned by `retryCursor` (or the attempted cursor after a thrown failure).
- Merge successful records before exposing returned enrichment/query errors.
- Hide Load more while a retryable error is outstanding.

## Rendering

Render history independently of the published catalog, including closed/unpublished forms. Render every returned `statusLabel`; known status values only determine badge styling, with a neutral fallback. History cards are read-only and have no workflow controls.

## Risks

Cursor loss, destructive error handling, cross-query duplicates, filtering history through published forms, and status/action leakage are the primary recurrence risks.
