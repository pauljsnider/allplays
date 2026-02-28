# Requirements Role Summary

## Objective
Ensure recurrence expansion includes the user-selected final calendar day when `recurrence.until` comes from the schedule date picker (`new Date('YYYY-MM-DD')` -> UTC midnight).

## Current State
`expandRecurrence` computes an `untilBoundary` and applies day-end inclusivity logic conditionally.

## Proposed State
Treat UTC-midnight date-only inputs as the primary normalization path before local-midnight handling so date-picker values are always converted to end-of-local-day boundaries.

## Risk Surface / Blast Radius
- Scope limited to recurrence end-date normalization in `js/utils.js`.
- Affects schedule recurrence expansion only.

## Assumptions
- Date picker persists `until` as UTC midnight via `Timestamp.fromDate(new Date(untilVal))`.
- Existing recurrence date semantics (UTC `instanceDate`) remain unchanged.

## Acceptance Criteria
- UTC date-only `until` values include occurrences through the intended final local day.
- Existing local-midnight `until` values remain inclusive.
