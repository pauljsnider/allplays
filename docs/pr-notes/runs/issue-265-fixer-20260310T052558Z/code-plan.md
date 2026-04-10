Implementation plan:
1. Add a small module for the cancel workflow so behavior can be unit-tested directly.
2. In that helper:
   - await `cancelGame(...)`
   - attempt `postChatMessage(...)` in a nested `try/catch`
   - return a result object describing `cancelled`, optional `notificationError`, or fatal `error`
3. Update `edit-schedule.html` to call the helper from the existing click handler and keep the UI messages aligned with the returned result.
4. Add a focused Vitest regression covering success-with-warning and fatal failure.

Tradeoffs:
- This introduces one new JS module, but it avoids brittle HTML-string-only testing for behavior.
- The patch remains narrow and keeps existing page structure intact.
