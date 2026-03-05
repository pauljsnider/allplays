# Requirements Role Summary

## Objective
Prevent ended finite recurring series from reappearing in calendar/schedule views when expansion starts near the visible window.

## Current vs Proposed
- Current state: `expandRecurrence` fast-forwards cursor near `windowStart`; without counting prior matches, `recurrence.count` can be misapplied.
- Proposed state: Preserve effective count semantics by ensuring pre-window occurrences are accounted for before in-window expansion and lock behavior with regression coverage.

## Risk Surface / Blast Radius
- Surface: recurrence expansion used by scheduling/calendar rendering.
- Blast radius: incorrect visibility of ended practices, confusing parents/coaches and undermining trust in schedule accuracy.

## Assumptions
- `recurrence.count` counts generated rule matches; `exDates` only suppress display/output, not count budget.
- Weekly rules with historical start dates are common in production teams.

## Acceptance Criteria
1. A weekly series with `count` fully consumed before `windowStart` returns no visible occurrences.
2. Existing daily/weekly interval behavior remains unchanged.
3. Change is covered by deterministic unit-style test in `tests/unit/recurrence-expand.test.js`.
