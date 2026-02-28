# Requirements Role Summary

## Objective
Fix recurring daily schedules so `interval > 1` produces occurrences every N days instead of every day.

## Current State
- Weekly interval matching already computes elapsed weeks from series start.
- Daily matching currently accepts all days and relies on pointer skipping, which can over-include dates.

## Proposed State
- Daily matching uses elapsed day math from series start (`daysSinceSeriesStart % interval === 0`).
- Regression tests cover daily `interval=2` and preserve `interval=1` behavior.

## Risk Surface / Blast Radius
- Scope limited to recurrence expansion logic in `js/utils.js` and unit tests.
- No schema/API changes.

## Acceptance Criteria
1. `freq=daily, interval=2` yields alternating-day dates.
2. `freq=daily, interval=1` remains daily.
3. Existing weekly interval tests continue passing.
