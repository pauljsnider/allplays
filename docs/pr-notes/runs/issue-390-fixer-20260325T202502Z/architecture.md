Current state:
- `parent-dashboard.html` owns button click handling, submission routing, state mutation, and rerender in one inline block.

Proposed state:
- Move only the RSVP click/controller behavior into `js/parent-dashboard-rsvp-controls.js`.
- Keep event scope resolution in `js/parent-dashboard-rsvp.js`.
- Keep rendering in `parent-dashboard.html`.

Why this shape:
- It is the smallest change that enables behavioral tests for the actual dashboard flow.
- It preserves the current UI and backend contract.
- It avoids introducing a DOM or browser harness where the repo already standardizes on Vitest.

Control equivalence:
- Payload scoping still flows through `resolveRsvpPlayerIdsForSubmission`.
- Single-child submits still route through `submitRsvpForPlayer`.
- Multi-child submits still route through `submitRsvp`.
- Local mutation is constrained to matching `teamId` and `gameId`, with extra child scoping for single-player updates.

Rollback plan:
- Revert the helper import and new module; inline logic can be restored without data migration.
