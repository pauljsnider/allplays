## Requirements Role Summary

- Objective: ensure undoing a logged stat emits the actual reversed delta applied locally, not the original logged amount.
- Current state: `undoLogEntry` clamps local stat totals at zero but can still publish the full negative logged value into `liveEvents`.
- Proposed state: compute the effective undo delta after clamping and reuse that value for live stat broadcasting and any score rollback tied to point stats.
- Risk surface: live viewer totals and visible scoreboard can diverge from the tracker if remote consumers apply a larger negative delta than the tracker actually applied.
- Assumptions:
  - `live-game.js` and other viewers rebuild totals from `liveEvents`.
  - Undo is allowed after prior manual corrections, so the original logged value may exceed the remaining current stat.
- Recommendation: patch only `track-live.html` and add a focused regression test that asserts the effective delta variable is used in the undo broadcaster.
- Success measure: undoing a previously corrected stat produces identical post-undo totals locally and in any viewer fed by `liveEvents`.
