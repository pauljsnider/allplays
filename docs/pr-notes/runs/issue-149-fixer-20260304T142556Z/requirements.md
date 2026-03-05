# Requirements Role Synthesis (Fallback)

## Note on orchestration tooling
Requested skills (`allplays-orchestrator-playbook`, `allplays-requirements-expert`) and `sessions_spawn` are not available in this runtime. This artifact captures equivalent requirements analysis.

## Objective
Ensure active recurring practice series continue to render upcoming occurrences in `edit-schedule.html` even when the master start date is more than a year in the past.

## Current vs proposed behavior
- Current: `expandRecurrence(master)` iterates day-by-day from original `seriesStart` with `maxIterations = windowDays * 2` (default 360), which can terminate before reaching the current visible window for older series.
- Proposed: anchor recurrence expansion near the visible window start while preserving recurrence cadence, so old series can still generate occurrences in the active schedule window.

## Acceptance criteria
1. Weekly recurring series that started well before the 180-day horizon still produce upcoming occurrences when recurrence has no end.
2. Daily/weekly interval logic remains unchanged for recent series.
3. Existing recurrence end constraints (`until`, `count`, `exDates`, `overrides`) continue to apply.

## Risk surface and blast radius
- Surface: `expandRecurrence` in `js/utils.js`.
- Blast radius: schedule and any consumers of recurrence expansion.
- No Firestore write path changes.

## Assumptions
- UI expects only occurrences within `[now-14d, now+windowDays]`.
- `count` semantics should remain based on generated matching occurrences from series start when in-range alignment is reconstructed.
