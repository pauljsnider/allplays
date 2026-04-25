# QA

## Risk Assessment
- Primary risk: partial notification delivery incorrectly marked as total failure.
- Secondary risk: metadata not written after one successful post.

## Test Matrix
- First target fails, second succeeds: helper reports partial success and continues.
- Both targets fail: helper reports full failure.
- Cancel game flow still returns non-fatal notification errors without blocking cancellation.

## Regression Guardrails
- Keep unit coverage at the helper level for deterministic success/failure combinations.
- Preserve existing wiring tests for `edit-schedule.html` and cancellation helper imports.

## Exit Criteria
- Targeted unit tests covering partial success and full failure pass.
- No first-error abort remains in the schedule update notification path.
