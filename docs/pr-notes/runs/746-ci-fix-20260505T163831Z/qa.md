# QA Notes

## Affected behavior
The failure is a unit test harness parse failure, not a runtime replay behavior failure. The affected suite covers replay initialization, scoreboard fallback, replay controls visibility, and replay chat lockout.

## Validation commands
- `npx vitest run tests/unit/live-game-replay-init.test.js`
- `npm run test:unit:ci`

## Edge cases to preserve
- Replay pages with no saved events keep chat disabled and show the locked notice.
- Replay pages with saved events use the same chat lockout behavior.
- Scoreboard fallback continues to render for replay pages without saved events.

## Confidence criteria
The targeted replay init unit test must parse and pass, and the full unit CI command must complete without the prior `AsyncFunction` syntax failure.
