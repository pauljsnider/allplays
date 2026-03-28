## Architecture Role Summary

- Blast radius is limited to the tracker undo flow in `track-live.html`.
- The data contract should preserve control equivalence: `liveEvents.type=stat` must represent the same delta that was actually committed to local tracker state.
- Smallest safe change: derive `appliedDelta = currentVal - newVal` after clamping, then use `appliedDelta` for:
  - stat persistence in memory and DOM
  - point-score rollback
  - `broadcastReversedStatEvent`
- Rollback is trivial because the change is isolated to client-side event emission and one unit test.
- Instrumentation signal: the emitted `liveEvents.value` now matches the user-visible tracker delta in partial-undo scenarios.
