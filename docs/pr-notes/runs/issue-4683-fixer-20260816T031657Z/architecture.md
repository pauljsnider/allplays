# Architecture

## Current State

`organization-schedule.html` writes shared games but has no organization read model. `cancelGame()` routes through `updateGame()`, whose reciprocal-sync failure is logged and swallowed, so source-only cancellation can appear successful.

## Proposed Design

- Add a pure canonicalization helper in `js/organization-schedule.js`.
- Require two distinct organization-owned records with identical shared IDs and exact reverse team/game pointers.
- Support both current source schemas: source marker absent on `addGame` records or set to the source team on draft-published records.
- Load all organization teams in bounded chunks and publish a new list only after every read succeeds.
- Preserve the last complete list on read failure.
- Render with safe DOM APIs and authorized team metadata.
- Reuse `cancelScheduledGame`, passing an adapter that calls `cancelGame`, reloads both exact records with `getGame`, and rejects unless both remain reciprocal and cancelled.
- Refresh after every publishing path and cancellation.

## Security And State

- No schema, Functions, rules, or `js/db.js` changes.
- Both teams must be in the accessible organization grouping before a pair renders.
- Both teams must grant full access before Cancel renders.
- Team names come from authorized team records, not opponent labels.

## Failure Modes

- Any team read failure preserves prior complete state and shows a retryable error.
- Malformed or ambiguous reciprocal pairs do not render.
- Reciprocal cancellation failure is detected before chat notifications.
- Notification failure refreshes authoritative cancelled state but suppresses full success.
