Objective: keep game cancellation successful when the follow-up team chat notification fails.

Current state:
- Cancel flow in `edit-schedule.html` treats `cancelGame(...)` and `postChatMessage(...)` as one atomic operation in the UI.
- A chat write failure after the game document update misreports the result as a failed cancellation.

Proposed state:
- Cancellation remains the source-of-truth operation.
- Chat notification is a best-effort follow-up. If it fails, the UI must still reflect that the game was cancelled.

Risk surface and blast radius:
- Affects only the cancel-game action in Edit Schedule.
- Blast radius is limited to user messaging for one workflow, but current behavior can trigger duplicate retries and support confusion.

Assumptions:
- Users care more about the schedule state being correct than a non-critical chat side effect succeeding.
- A warning is acceptable when chat notification fails, but the cancellation must not be rolled back or described as failed.

Recommendation:
- Separate fatal cancellation failure from non-fatal chat notification failure in the client workflow.
- Add regression coverage for both branches so the distinction does not regress.

Success measure:
- When `cancelGame(...)` succeeds and `postChatMessage(...)` throws, the UI still reports success and refreshes the schedule.
