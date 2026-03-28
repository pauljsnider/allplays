Objective: Prevent PR #219 game-finalization from failing after the primary finish batch succeeds when tournament advancement backfill exceeds Firestore batch limits.

Current state:
- `track-live.html` computes `advancementPatches` after the main game completion batch commits.
- All tournament backfill updates are pushed into one Firestore `writeBatch`.

Proposed state:
- Keep the existing flow, but commit tournament advancement updates in bounded chunks below Firestore's 500-write limit.

Risk surface and blast radius:
- Current failure mode leaves the game completed while surfacing an error to the user.
- Retrying can duplicate earlier event-log writes because the first batch already succeeded.
- Scoped blast radius is tournament backfill after finish; primary game finalization logic should remain unchanged.

Assumptions:
- Each advancement patch maps to exactly one Firestore update.
- No server-side transaction is available for this static client flow.
- Narrow remediation is preferred over broader finish-flow refactoring.

Recommendation:
- Split advancement writes into fixed-size batches and commit sequentially.
- Add a focused unit assertion so future edits do not regress to one unbounded batch.

Success criteria:
- Finalizing a game with more than 500 tournament backfill updates no longer fails on Firestore batch size.
- Existing finish behavior remains unchanged for smaller tournaments.
