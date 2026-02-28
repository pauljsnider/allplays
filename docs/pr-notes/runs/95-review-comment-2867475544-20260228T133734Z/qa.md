# QA Role (Fallback Synthesis)

## Tooling status
Requested skill `allplays-qa-expert` and `sessions_spawn` are not available in this runtime; this file records equivalent QA analysis.

## Regression targets
- Weekly recurrence with `interval > 1` and explicit `byDays`.
- Weekly recurrence with no `byDays` (series-start weekday fallback).
- DST-adjacent dates where UTC/local midnight boundaries diverge.

## Quick validation strategy
- Static verification that both day-number lines now use `getTime()`.
- Sanity execution of recurrence expansion in Node across a DST-boundary fixture.

## Guardrails
- Confirm unchanged loop control and match conditions except day-number derivation.
- Confirm no impact to exDates/overrides handling.
