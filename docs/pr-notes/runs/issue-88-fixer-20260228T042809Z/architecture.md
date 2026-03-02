# Architecture Role (manual fallback)

## Root cause
`expandRecurrence` matches weekly days by weekday only and then increments one day at a time. No weekly interval gate exists, so all matching weekdays are emitted every week.

## Minimal safe design
Compute elapsed days from series start to current candidate date, convert to elapsed weeks via `Math.floor(days / 7)`, and only match weekly dates when `elapsedWeeks % interval === 0`.

## Why this is safe
- Targets only weekly matching branch.
- Leaves daily skip logic intact.
- Preserves by-day behavior and no-byDays fallback.
