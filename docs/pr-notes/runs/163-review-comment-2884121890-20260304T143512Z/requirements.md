# Requirements Role Summary

## Objective
Confirm whether weekly recurrence expansion preserves RRULE cadence when iteration jumps from series start to visible window.

## User-impact framing
- A coach/parent expects recurring Monday/Wednesday practices set as biweekly to remain biweekly even for long-running series.
- Any cadence drift causes incorrect schedule visibility and RSVP confusion.

## Acceptance criteria
- Weekly interval math remains anchored to series week boundary, not the jumped cursor week.
- Long-running series (start in 2024, viewed in 2026) with `interval: 2` and `byDays: ['MO','WE']` only emits on-cadence weeks.
- No false positives in the immediate off-cadence week after window start.

## Assumptions
- Week boundary semantics are local `Date.getDay()` based (Sunday start), consistent with current implementation.
- Existing behavior for daily and interval=1 weekly rules must remain unchanged.
