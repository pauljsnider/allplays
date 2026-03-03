# QA Role Synthesis

## Regression strategy
- Add parser unit test that fails pre-fix for recurring RRULE expansion.
- Validate with targeted Vitest run covering ICS parser + existing timezone/parser regressions.

## New test coverage
- RRULE weekly + `COUNT=4` emits 4 dated occurrences.
- `EXDATE` removes one recurrence instance.

## Guardrails
- Ensure pre-existing ICS tests still pass (`utils-ics-practice-classification`, `ics-timezone-parse`, `utils-calendar-fetch`).
- No UI snapshot/manual-only assertions required for this parser-layer bug.
