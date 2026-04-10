# Architecture Role Notes

## Current State
`currentTeamId` eventually drives `createTeam` vs `updateTeam` in submit handler. Initialization is async and can lag behind user actions.

## Proposed State
- Capture `teamId` once from URL at module load.
- Seed `currentTeamId` from that value synchronously.
- Introduce `isInitPending` gate to block submit until init completes.

## Tradeoffs
- Slightly stricter UX (save button disabled during initial load) in exchange for deterministic write path.
- Minimal footprint: single-page script, no API changes.

## Rollback
Revert `edit-team.html` changes to remove pre-seeding and init gate.
