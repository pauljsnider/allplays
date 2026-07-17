# Architecture Review

## Current-State Read

- `status` and `liveStatus` can contradict each other.
- The patch enforces terminal cancellation on legacy and app writes, filters stale records from discovery, and normalizes viewer state.
- Shared counterparts are separate game documents with separate event streams.

## Proposed Design

- Enforce cancellation at two boundaries: write both terminal fields, then defensively reject stale cancelled records at discovery and viewer boundaries.
- Stop active viewer subscriptions when cancellation arrives.
- Mirror only terminal cancellation to shared counterparts; never mirror active live state without routing to the source event stream.
- Version the changed nested shared-schedule module so deployed clients cannot reuse stale mirror logic.

## Files And Modules Touched

- `js/db.js`, `js/live-game.js`, `js/live-game-chat.js`, `js/shared-schedule-sync.js`
- `apps/app/src/lib/scheduleService.ts`
- `index.html`, `edit-schedule.html`, `live-game.html`
- Focused tests under `tests/unit/`

## Data/State Impacts

- Source and synchronized counterpart cancellation state becomes `status: cancelled`, `liveStatus: cancelled`.
- Existing inconsistent records remain safe at read boundaries without migration.
- Cancellation disables live mode and engagement state in open viewers.

## Security/Permissions Impacts

- Existing cancellation and cross-team authorization boundaries remain unchanged.
- Client gating prevents normal UI writes after cancellation but is not a server authorization control against modified clients.

## Failure Modes And Mitigations

- Stale nested module cache: version `shared-schedule-sync.js` and test the import key.
- Native REST fallback can bypass counterpart synchronization: retain defensive discovery/viewer filtering; treat full fallback parity as follow-up scope.
- Viewer game subscription is removed on terminal cancellation: acceptable because restore-without-reload is not a supported workflow.
