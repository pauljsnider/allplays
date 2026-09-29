# Patch Plan

1. Add `getPublicTeamStandings` to the page service mock and write loading, success/highlight, metric, empty, and failure-isolation regressions first.
2. Import `getPublicTeamStandings` and its result type in `PublicTeamDetail`.
3. Represent pending standings as `undefined`, legitimate unavailability as `null`, and successful rows as the service result.
4. Track standings errors independently and reset all standings state on route/retry changes.
5. Start standings and recent-results hydration independently after profile validation.
6. Render local loading, error, existing empty, or existing table states.

# Code Changes Applied

Analysis only at orchestration time. The main lane owns all edits.

# Validation Run

Run `npm run test:app -- src/pages/PublicTeamDetail.test.tsx` after the regression-first implementation.

# Residual Risks

- The service performs a second bounded profile read.
- Standings and recent results each load the completed-games projection.
- A dedicated standings retry is out of scope.

# Commit Message Draft

`Render native public team standings (#4788)`

# Orchestrator Synthesis

## Acceptance Criteria

Independent loading; service-authoritative points/PCT rendering; current-row highlighting; preserved empty state; isolated failure.

## Architecture Decisions

Use the existing public service as the sole computed source, `undefined`/`null`/value state semantics, a separate error flag, and the existing cancellation guard.

## QA Plan

Regression-first component tests map directly to each issue criterion, with focused app Vitest as the local gate.

## Implementation Plan

Change only the public page and its colocated component test, plus required run artifacts.

## Risks And Rollback

Risk is limited to public page transient state and an extra bounded read. Rollback is a single commit revert with no data migration.
