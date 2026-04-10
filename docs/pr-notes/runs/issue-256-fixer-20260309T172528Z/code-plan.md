## Role
Code-plan synthesis fallback for issue #256.

## Thinking Level
- Medium: small code change, but it affects destructive workflow semantics and needs targeted regression coverage.

## Plan
1. Add `runGameCancellationFlow(...)` helper in `js/` for cancellation + chat notification orchestration.
2. Add Vitest coverage for successful cancellation with notification failure, plus fatal cancellation failure.
3. Update the `edit-schedule.html` cancel handler to use the helper and present accurate alerts.
4. Run relevant unit tests.
5. Commit the targeted change set for issue #256.
