# Architecture Role Summary

Thinking level: medium

## Decision
Handle partial read failures at the parent dashboard aggregation boundary, not inside `calculateEarnings`.

## Why
- The earnings engine is a pure function and should remain ignorant of transport and storage failures.
- `getAggregatedStatsForPlayer` already provides context-rich logging and an explicit failure signal.
- `Promise.allSettled` narrows blast radius from "whole panel unavailable" to "specific game rows unavailable."

## Design Notes
- Keep fulfilled game stats in original order for deterministic rendering.
- Delete cache entries when stats are missing or failed so schedule chips do not reuse stale values.
- Render a warning banner with the excluded-game count to preserve auditability for the parent-facing total.
