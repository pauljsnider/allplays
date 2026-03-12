## Role
Requirements synthesis fallback for issue #256.

## Constraints
- Preserve the existing coach cancellation workflow in `edit-schedule.html`.
- Once the game document update succeeds, the UI must treat the cancellation as successful.
- A chat notification failure is non-fatal and must not masquerade as a cancellation failure.
- Keep blast radius limited to schedule cancellation UX and related tests.

## Recommendation
- Split the flow into two outcomes:
  - cancellation success/failure
  - notification success/failure
- Refresh the schedule after a successful cancellation regardless of chat outcome.
- Surface a specific follow-up alert when chat notification fails so the coach understands the game is already cancelled.

## Success Criteria
- If `cancelGame(...)` throws, the UI still reports cancellation failure.
- If `cancelGame(...)` succeeds and `postChatMessage(...)` throws, the UI reports cancellation success with notification failure.
- The schedule refreshes after successful cancellation in both notification success and failure paths.
