# QA Role Summary

## Regression Focus
- Finite weekly recurrence with historical start date and exhausted `count` before visible window.

## Test Strategy
- Freeze time to `2026-03-01T12:00:00Z`.
- Create weekly Monday series starting `2024-01-01T17:00:00Z` with `count: 5`.
- Expand 45 days and assert zero occurrences.

## Guardrails
- Ensures no ended series resurfacing in calendar views.
- Complements existing interval/cadence tests already in file.

## Residual Risk
- Full suite execution unavailable in this repo snapshot (no package test runner config in checkout).
