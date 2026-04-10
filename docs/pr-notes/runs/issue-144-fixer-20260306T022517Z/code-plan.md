# Code role (fallback synthesis)

## Constraint note
Requested `allplays-orchestrator-playbook` and role skills are not installed in this environment; proceeding with equivalent in-run synthesized role outputs.

## Plan
1. Add a small pure helper in RSVP domain to decide when legacy `userId` doc is safe to delete after per-player override.
2. Add failing unit tests for that helper to encode sibling-preservation behavior.
3. Wire helper into `submitRsvpForPlayer` cleanup path in `js/db.js`.
4. Add/adjust RSVP summary regression test for override doc-id shape.
5. Run targeted unit tests.
6. Commit with issue reference.

## Assumptions
- Legacy cleanup is intended for stale single-player docs, not parent multi-player docs.
- Existing summary de-duplication remains source of truth for one-player-one-status counting.
