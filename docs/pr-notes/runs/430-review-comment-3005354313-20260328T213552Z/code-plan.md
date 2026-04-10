## Code Role Plan

- Patch `window.undoLogEntry` in `track-live.html`.
- Compute `appliedDelta` separately for opponent and home-player branches using `currentVal - newVal`.
- Reuse `appliedDelta` for point-score rollback and `broadcastReversedStatEvent({ value: -appliedDelta })`.
- Update the focused `tests/unit/track-live-live-events.test.js` assertion to require the effective delta variable instead of the old raw logged value.
