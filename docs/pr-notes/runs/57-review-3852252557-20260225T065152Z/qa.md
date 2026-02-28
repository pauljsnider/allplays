# QA Role (allplays-qa-expert)

## Objective
Prove the two P1 regressions are fixed and prevent recurrence.

## Risk-Based Test Focus
- Boundary tolerance positive case: invocation slightly after boundary executes.
- Boundary tolerance negative case: invocation outside tolerance still skips.
- Fanout failure safety: failed fanout does not advance state or idempotency markers.
- Existing behavior sanity: changed/unchanged event processing and guardrail isolation tests still pass.

## Validation Commands
- `npx vitest run tests/unit/rainout-polling-runtime.test.js`

## Acceptance Criteria
- Updated runtime unit suite passes.
- New tests explicitly cover both reported P1 cases.
