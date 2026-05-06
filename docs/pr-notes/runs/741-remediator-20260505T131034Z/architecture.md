# Architecture

## Decision
Move the `broadcastLiveEvent(...)` call in `logFootballPlay()` out of the `if (gameState.isRunning)` guard while keeping the pre-start guard intact.

## Rationale
- The started-game check already prevents pre-game event writes.
- Paused-clock football plays are legitimate live play-by-play records and should share the same event stream as running-clock football plays.
- This is the smallest change and preserves the existing `football_play` schema, clock timestamp, score fields, and possession behavior.

## Blast Radius
Scoped to football play logging in `track-live.html`. No changes to generic stat events, clock sync, lineup, chat, or Firestore rules.

## Rollback
Restore the `gameState.isRunning` guard around the football broadcast call if viewer behavior regresses.
