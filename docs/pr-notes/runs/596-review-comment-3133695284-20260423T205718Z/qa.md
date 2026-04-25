# QA

## Risk Assessment
- Primary risk: away tournament results appear inverted in standings and downstream win/loss summaries.
- Regression risk: home-game standings order or unresolved-tie behavior changes unintentionally.

## Test Matrix
1. Home tournament game still produces expected standings row.
2. Away tournament game with team-relative score storage is remapped into a team win.
3. Mixed pool data still groups rows correctly and keeps Tigers on top when two wins are present.
4. Existing HTML wiring test still confirms the standings section remains connected.

## Edge Cases
- Away losses should remain losses after remap.
- Tied away games should remain ties after remap.
- Non-tournament games must still be excluded.

## Minimum Validation Commands
- `npm ci`
- `npm test -- tests/unit/tournament-standings.test.js tests/unit/team-tournament-standings.test.js`
