# Requirements Role Notes

## Objective
Resolve unresolved PR #95 review feedback in `js/utils.js` recurrence expansion logic.

## Required outcomes
- Eliminate UTC/local timezone inconsistency in day-number calculations.
- Ensure weekly interval gating is aligned to calendar week boundaries, not start-date 7-day buckets.
- Keep change scoped to recurrence logic only.

## Assumptions
- Existing recurrence semantics define week buckets by local calendar weeks (Sunday-based via `DAY_CODES`).
- `instanceDate` keys should map to the same local day used by recurrence matching.

## Acceptance
- Biweekly multi-day recurrence starting midweek skips off-cadence days in alternating weeks.
- No `Date.UTC(...)`-style day-number mixing with local date iteration remains in this path.
