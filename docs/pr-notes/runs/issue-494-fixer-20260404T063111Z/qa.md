# QA Role (fallback synthesis)

## Test Strategy
1. Add a replay rendering test that asserts the dynamic card replaces the loading placeholder and includes team name, opponent, score, formatted date, and the replay URL contract.
2. Add an empty-state test for `No recent replays available`.
3. Keep the existing error-state coverage for `Unable to load replays`.

## Regression Guardrails
- Assert against exact user-facing strings for fallback states.
- Check the generated href contains the expected `teamId`, `gameId`, and `replay=true` parameters.
- Keep live-games assertions intact so homepage parallel loading behavior still has coverage.

## Manual Smoke (optional)
- Load `index.html` with seeded completed live-tracked game data and confirm the replay card links into `live-game.html?...&replay=true`.
