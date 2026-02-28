# QA Role Notes

## Regression focus
- Last-read should not update while tab hidden.
- Last-read should not update when browser window lacks focus.
- Last-read should still update during normal active viewing.

## Validation plan
- Unit tests for helper with visibility/focus permutations.
- Quick targeted test run for `team-chat-last-read` spec.

## Residual risk
- Browser-specific focus semantics can vary slightly; policy still errs safe by requiring both visible and focused.
