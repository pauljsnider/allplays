# QA Role Synthesis

## Failing-first coverage targets
- Reset event projection clears live viewer state.
- Foul column is not added unless configured.
- Opponent display name picks linked-opponent fields when present.
- On-field timing accumulates only while player is on field.

## Regression checks
- Live chat still initializes and sends.
- Score updates still reflect stat buttons.
- Period changes still broadcast and render.
- Replay mode unaffected by new reset logic.

## Manual scenarios
1. Start game in `track-live.html`, add stats, open `live-game.html`, click Reset in tracker, verify viewer zeros/clears immediately.
2. Use config without foul column, verify `FLS` absent in viewer player cards/opponent cards.
3. Linked opponent team game with `opponentTeamName`, verify title and away team name populate.
4. Toggle player `On`/`Bench`, run timer, verify elapsed field time increments only while `On`.
