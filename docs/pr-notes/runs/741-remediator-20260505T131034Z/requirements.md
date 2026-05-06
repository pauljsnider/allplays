# Requirements

## Acceptance Criteria
1. Football play logging remains blocked before the game has ever started (`!gameState.isRunning && gameState.elapsed === 0`).
2. Once a game has started, football plays recorded while the timer is paused are written to the local game log and broadcast to `liveEvents`.
3. Football plays recorded while the timer is running continue to broadcast with the same event payload shape.
4. Existing possession toggle behavior for turnover, punt, and kickoff is unchanged.

## Edge Cases
- Dead-ball penalties, timeout entries, and between-play entries with a paused clock still appear in viewer play-by-play.
- Pre-game accidental taps still show the existing start-timer alert and do not emit events.
