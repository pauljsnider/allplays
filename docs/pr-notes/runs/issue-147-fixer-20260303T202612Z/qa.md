# QA Role - Issue #147

## Test Strategy
1. Add regression test asserting `calendar.html` ICS mapping does not hardcode `status: 'scheduled'`.
2. Assert mapping includes cancellation detection from:
   - `event.status?.toUpperCase() === 'CANCELLED'`
   - `event.summary?.includes('[CANCELED]')`
3. Run targeted Vitest suite for new test.

## Regression Guardrails
- Keep assertions scoped to ICS mapping block near `fetchAndParseCalendar` usage.
- Avoid brittle full-file snapshot tests.

## Risks
- False negatives if code formatting changes significantly; mitigate with focused regex checks for semantic expressions.
