Implementation plan:
1. Replace the single `advancementBatch` write in `track-live.html` with a loop over bounded slices.
2. Keep the per-patch update payload unchanged so only batching behavior changes.
3. Update `tests/unit/track-live-tournament.test.js` to assert the bounded batching loop exists.
4. Run the focused unit tests and commit the scoped fix.

Non-goals:
- No refactor of `collectTournamentAdvancementPatches`.
- No broader idempotency work for the finish flow.
