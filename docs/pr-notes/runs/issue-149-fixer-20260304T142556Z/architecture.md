# Architecture Role Synthesis (Fallback)

## Note on orchestration tooling
Requested skills (`allplays-orchestrator-playbook`, `allplays-architecture-expert`) and `sessions_spawn` are not available in this runtime. This artifact captures equivalent architecture analysis.

## Root cause model
The loop starts at `seriesStart` and advances one day per iteration. For old series, the guard `iterations < windowDays * 2` trips before `current` reaches the visible window, producing zero occurrences.

## Minimal-safe patch strategy
- Preserve existing matching logic for daily/weekly recurrence.
- Introduce an aligned cursor start:
  - compute an initial day at or before `windowStart` for each recurrence type.
  - for weekly rules, align to week boundaries used by existing `weeksSinceSeriesStart` modulo logic.
  - for daily rules, align by interval modulo from series start.
- Keep the existing day-by-day traversal and max-iteration safety bound, but make it relative to window traversal instead of series age.

## Conflict resolution
- Requirements wants correctness for old series.
- QA wants minimal regression risk.
- Resolved by changing only loop start alignment and adding regression tests without refactoring recurrence data model.
