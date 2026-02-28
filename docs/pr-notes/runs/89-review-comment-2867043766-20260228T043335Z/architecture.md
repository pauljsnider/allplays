# Architecture Role Summary

## Current state
Daily matching is computed from `daysSinceSeriesStart % normalizedInterval === 0`, but the iterator also performs a second interval-based date jump.

## Proposed state
Single-step date iteration for all recurrence frequencies, with interval control centralized in the match predicate only.

## Risk surface and blast radius
- Scope: `expandRecurringPractice` in `js/utils.js` only.
- Blast radius: recurrence generation for practice series.
- Risk reduction: removes duplicate interval application for daily schedules while preserving weekly interval calculations.
