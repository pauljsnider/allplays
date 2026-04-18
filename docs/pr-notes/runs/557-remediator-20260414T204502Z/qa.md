Risk Matrix
- High: tracker finish persistence regresses for live games near Firestore batch limits.
- Medium: mixed-case stat keys silently zero out saved player history.
- Low: zero-stat roster players disappear from aggregated history.

Automated Tests To Add/Update
- Update `test-track-zero-stat-player-history.js` to use the same normalization helper pattern as production.
- Add an explicit regression case for uppercase source keys (`PTS`, `REB`) with lowercase-normalized configured columns.

Manual Test Plan
1. Run `node test-track-zero-stat-player-history.js`.
2. In a local browser session, finish a tracked game with players who have uppercase/mixed-case stats and confirm saved history values are preserved.
3. Finish a game with a scoreless rostered player and confirm the player still has zeroed configured stats.
4. Smoke test a larger game log flow and confirm completion data persists.

Negative Tests
- Player stats object empty for a rostered player.
- Configured columns present while source stats use uppercase keys only.
- Extra non-config stats present in player history.

Release Gates
- Regression script passes.
- Tracker finish path still writes within Firestore batch limits.
- No unrelated file churn.

Post-Deploy Checks
- Verify one newly completed game shows correct aggregated player stats.
- Check that completed game summary/status saves even when roster-wide stat writes are chunked.