# QA Role Summary

## Regression risks
- Off-cadence weekly dates emitted after window jump.
- Hidden regressions for daily interval and weekly interval=1 behavior.

## Test strategy
- Keep existing 4 recurrence interval guardrail tests.
- Add one targeted test for 2024->2026 long-running biweekly MO/WE cadence.

## Pass criteria
- First six emitted dates match expected on-cadence weeks only.
- Immediate off-cadence week dates are explicitly absent.
- Entire recurrence-expand suite remains green.
