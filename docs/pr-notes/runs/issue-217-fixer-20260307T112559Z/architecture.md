Current state:
- Schedule creation/editing persists flat game fields only.
- Live tracker completion updates the current game only.

Proposed state:
- Add a pure `js/tournament-brackets.js` module to normalize slot rules, resolve pool seeds and prior-game winners, and calculate persisted bracket-resolution patches.
- Store tournament metadata inline on game docs under a `tournament` object to avoid a new collection and preserve existing access controls.
- Recompute bracket resolution in `track-live.html` after marking a game completed, then batch-update only affected tournament games.

Data shape:
- `tournament.bracketName`
- `tournament.roundName`
- `tournament.poolName`
- `tournament.slotAssignments.home|away`
- `tournament.slotAssignments.*.sourceType`: `team`, `pool_seed`, `game_result`
- `tournament.slotAssignments.*.teamName|poolName|seed|gameId|outcome`
- `tournament.resolved`: derived labels/team names persisted for display

Controls equivalence:
- No new collection or broader query scope beyond the team’s existing `games` subcollection.
- Existing Firestore access controls on team games remain the enforcement boundary.

Risks:
- Team-centric data model cannot deliver full tournament-wide administration. This patch intentionally implements bracket logic as an incremental extension of team schedules.
- Manual source entry can produce invalid references; helper functions must fail closed to placeholders.

Rollback:
- Remove tournament UI fields and helper usage; existing generic game docs remain readable because new fields are additive and optional.
