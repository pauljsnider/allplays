# QA Role Synthesis (fallback, no sessions_spawn available)

## Test strategy
Add unit tests around `parseICS` in `tests/unit/utils-ics-timezone.test.js`.

## Required coverage
- Repro: TZID event (`America/New_York`) maps to exact UTC instant independent of host locale.
- Guardrail: UTC `Z` timestamp unchanged.
- Guardrail: no-TZID timestamp still treated as floating local time (existing behavior).
- Optional: date-only all-day parse remains same date.

## Regression checks
Run new test file and full `tests/unit` suite with Vitest.
