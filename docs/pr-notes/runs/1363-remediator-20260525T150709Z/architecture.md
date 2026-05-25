# Architecture

## Architecture Decisions
- Treat `games/{gameId}/liveEvents/{eventId}` as append-only client-visible history.
- Client cancel flow should update the game document only; it must not mutate or delete live event documents because rules deny those writes.
- If eventual pruning is needed, that belongs in a trusted backend/admin migration, not the browser tracker.

## Risks And Rollback
- Risk: stale live events may remain visible if consumers ignore game status. Mitigation: existing consumers should key visibility from game status/live fields.
- Rollback: revert the small `cancelGame` patch and regression test.
