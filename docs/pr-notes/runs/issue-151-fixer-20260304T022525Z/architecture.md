# Architecture Role Synthesis (Fallback)

## Note on orchestration tooling
Requested skills (`allplays-orchestrator-playbook`, `allplays-architecture-expert`) and `sessions_spawn` are not available in this runtime. This artifact captures equivalent architecture analysis.

## Root cause model
ICS parsing in `js/utils.js` preserves `STATUS`, but calendar ingestion discards it and writes a fixed status. This severs cancellation metadata from render-time policy.

## Minimal-safe patch strategy
- Add a tiny cancellation helper in `calendar.html` near ICS ingestion.
- Derive status during import:
  - cancelled if `ev.status?.toUpperCase() === 'CANCELLED'`
  - cancelled if summary contains `[CANCELED]` (case-insensitive)
  - otherwise scheduled
- Keep scope constrained to ICS import block; do not alter DB event handling or parseICS internals.

## Conflict resolution
- Parent dashboard already supports both cancellation signals; align calendar behavior with that precedent.
- Preserve existing summary/title text behavior (no summary rewriting in this bugfix).
