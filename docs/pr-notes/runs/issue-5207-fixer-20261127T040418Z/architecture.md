# Architecture analysis

## Decision

Route the legacy dashboard box to `/app/#/accept-invite?code=...` instead of importing the full processor and all of its dependencies into `parent-dashboard.html`.

## Rationale

- The app accept-invite route is the active canonical UI and already delegates to the shared `js/accept-invite-flow.js` processor.
- The shared processor validates the code before dispatching `parent_invite`, `household_invite`, and `coparent_invite` to separate redemption handlers.
- A redirect removes the incorrect page-local type assumption without duplicating dependency wiring, messages, email checks, or redirect logic.
- No cache-critical module changes or new legacy imports are required, so no import-version cohort or smoke module stub changes are needed.

## Recurrence risk

Low after a source-contract regression test asserts that generic invite entry points route through the canonical accept-invite flow and do not call a type-specific redeemer.

The requested architecture subagent could not start because the subagent runtime reported `published reply runtime missing for main`; this artifact records the main-run synthesis needed to continue.
