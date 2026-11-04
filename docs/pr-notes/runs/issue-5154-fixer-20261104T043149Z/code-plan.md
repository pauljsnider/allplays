# Code Plan — Issue #5154

## Root cause

`setPeriod()` assigns the new value but guards all change-specific side effects with `state.running`. Paused changes therefore leave the game document and live-event stream stale, and those stale authoritative sources later override the indirectly saved local state during resume.

## Minimal patch

In `js/live-tracker.js`, replace the running-and-changed condition with a changed-value-only branch. Inside it:

1. add the existing period-change log;
2. call `persistLocalTrackerState()`;
3. call `syncClockToGameDoc()`;
4. retain the `liveState.isLive` guard around the existing `period_change` broadcast.

Keep `renderHeader()` after the branch and keep `setPeriod()` synchronous. The equality guard prevents boot-time and repeated-selection side effects.

In `tests/unit/live-tracker-period-buttons.test.js`, execute the extracted production function with mocks. Assert the complete paused Q1 → Q2 contract and a same-period no-op. Run only the focused Vitest file.

## Prevention / learning

Every real period change must update local recovery state, persisted clock state, and live events based on value change rather than clock-running state.

## Recurrence risk

**Medium** — the code change is small, but restore precedence makes any future partial synchronization visible.
