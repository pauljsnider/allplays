# Architecture Role (allplays-architecture-expert equivalent fallback)

Requested orchestration skill `allplays-orchestrator-playbook`, role skill `allplays-architecture-expert`, and `sessions_spawn` are unavailable in this runtime. This artifact captures equivalent architecture analysis.

## Current State

- `parent-dashboard.html` owns rideshare rendering, child-selection resolution, and async handlers inline.
- That structure makes the stateful child-request path hard to test directly.

## Proposed Change

- Extract rideshare child-selection and request/cancel handler logic into a dedicated ES module.
- Keep DOM rendering in `parent-dashboard.html`; move only pure/handler logic needed for automated coverage.

## Blast Radius

- Limited to Parent Dashboard rideshare logic.
- No Firestore schema changes.
- No changes to unrelated schedule, RSVP, or practice packet flows.

## Control Notes

- Preserve existing backend function calls and rerender order.
- Keep inline HTML event handlers intact by wiring the same `window.*` functions from the new module.
- Prefer additive changes over refactoring large modal sections.
