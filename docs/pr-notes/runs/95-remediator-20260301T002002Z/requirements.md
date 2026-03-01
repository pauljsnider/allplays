# Requirements Role Analysis (manual fallback)

## Objective
Resolve unresolved PR #95 review feedback for recurrence expansion with minimal blast radius and regression-safe behavior.

## Constraints
- Scope limited to unresolved review comments in `js/utils.js` recurrence interval logic.
- Preserve existing recurrence behaviors outside the interval/date-bucket defects.
- Add/maintain tests for impacted recurrence workflows.

## Evidence
- Review comment `r2867475544`: day-number calculation should not use `Date.UTC(...)` with local date iteration.
- Review comment `r2867475547`: same issue for `currentDayNumber`.
- Review comment `r2867475814`: weekly interval must align to calendar week boundaries, not rolling 7-day buckets anchored to series start.

## Acceptance Criteria
1. Day-number calculations use `getTime() / MS_PER_DAY` for both series start and current date.
2. Weekly interval gating computes from week-start boundaries so biweekly multi-day series skips off-cadence next-week dates.
3. Existing daily interval behavior remains correct.
4. Focused tests pass.

## Assumptions
- Week boundary convention is Sunday-based (`Date#getDay()`), consistent with existing code path and day-code mapping.
- No product requirement currently mandates locale-specific week start customization.
