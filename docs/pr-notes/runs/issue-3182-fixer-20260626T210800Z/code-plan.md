# Code Plan

## Root Cause Hypothesis
Tournament creation had been surfaced as an inline form state under Manage schedule instead of a distinct shell/modal. That made open/cancel behavior ambiguous and left no dedicated dismiss flow.

## Minimal Code Change
- Keep the tournament entry card in staff tools.
- Render the existing tournament form inside a modal shell when opened.
- Reset tournament form state and errors on cancel/dismiss.
- Close the shell after successful create.

## Test Targets
- `tests/unit/app-schedule-desktop-controls.test.jsx`
- `apps/app/src/pages/Schedule.tsx`

## Validation Command
- `npx vitest run tests/unit/app-schedule-desktop-controls.test.jsx --reporter=verbose`

## Risks
- Low. Local Schedule UI only.
