# Requirements Role Summary

## Objective
Ensure weekly recurrence `interval` semantics honor calendar-week cadence for multi-day `byDays` patterns.

## Current State
Weekly interval gating uses 7-day buckets anchored to the series start date, which can include off-cadence days when the series starts mid-week.

## Proposed State
Gate weekly occurrences by week-start boundaries (Sunday-based, consistent with `getDay()` and existing day-code mapping), then apply `interval` on week offsets.

## Acceptance Criteria
- Biweekly series starting on Wednesday with `byDays=['MO','WE']` excludes the immediate next Monday.
- Included weeks produce only in-cadence weekdays.
- Existing weekly interval behavior for aligned starts remains unchanged.
