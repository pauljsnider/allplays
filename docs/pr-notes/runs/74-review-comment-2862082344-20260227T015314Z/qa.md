# QA Role Summary

## Regression Focus
- Report page (`game.html`) no longer errors when team is inactive.
- Replay page (`live-game.html`) can render metadata for inactive teams.
- No regression to active-only filtering in list/discovery flows.

## Validation Plan
1. Run unit tests for team visibility policy helper.
2. Run related live-game unit tests for replay page behavior baseline.
3. Verify diff scope is limited to route-level includeInactive opt-in.
