# Architecture Role Notes

Thinking level: medium.

## Current state
- Viewer reset handling (`applyResetEventState`) clears local event ID tracking.
- Tracker pre-start clear path deletes `events` and `aggregatedStats` but leaves `liveEvents` docs in Firestore.

## Risk surface
- Leftover `liveEvents` are treated as unseen after reset, causing stale score/stats replay.
- Blast radius limited to live-game reset/restart flows.

## Proposed state
- Include `liveEvents` deletion in pre-start clear branch to keep Firestore and viewer state aligned.
