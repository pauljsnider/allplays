# Code Plan

## Patch Plan

1. Keep the focused standings page and adapter implementation.
2. Remove broad auth/notification smoke mocks that created a 24-test blast radius.
3. Add one scoped signed-out, populated 320px Playwright regression.
4. Retain component coverage for disabled, empty, and unavailable states.

## Code Changes Applied

- Removed branch-only auth and notification-loader mocks from app auth/profile, messages, schedule, and shared teams smoke harnesses.
- Added a `signedOut` option to the teams smoke auth boundary.
- Extended the public-team smoke stub with enabled configuration, completed inputs, populated native rows, and league URL.
- Added browser assertions for the standings table, PTS header, current-team `aria-current`, league link, no unexpected page errors, and no 320px page overflow.

## Validation Run

- Planned focused component, native standings, lint, build, and Playwright commands are recorded in `qa.md`; final observed results are added to the GitHub handoff only after execution.

## Residual Risks

- Team-name matching has no canonical ID fallback.
- Team-scoped projections do not prove complete league-wide schedules.
- JSDOM route-race and computation-throw regressions remain useful follow-up coverage.

## Commit Message Draft

`Fix public standings smoke coverage (#4691)`

## Acceptance Criteria

- Signed-out public standings render from sanitized inputs with configured native behavior, highlighted current team, useful fallbacks, and no narrow-screen clipping.

## Architecture Decisions

- Preserve the explicit #4691/#4690 contract and existing native engine.
- Remove high-blast-radius harness mocks rather than changing product behavior to satisfy unrelated failures.

## QA Plan

- Run the nearest app unit suite, native engine unit suite, app lint/build, focused populated smoke, and impacted smoke files.

## Implementation Plan

- The main run owns all edits, validation, commit, push, PR update, and issue response.

## Risks And Rollback

- The patch is read-only product behavior plus test harness changes. Rollback is the final commit; no data repair is required.

## Conflict Resolution

- Architecture warned that team-scoped projections cannot prove a complete league table. Requirements and the issue explicitly bind this slice to #4690 inputs and existing native computation. This run preserves the defined behavior, documents the completeness limitation, and avoids an unauthorized backend/schema expansion.
- QA requested browser geometry evidence; the chosen patch adds one populated signed-out 320px regression instead of relying only on class assertions.
- CI history showed broad mocks raised failures from 1 to 24. Those mocks are removed; only import-surface stubs required by PublicTeamDetail remain.
