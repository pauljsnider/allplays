Objective: keep game cancellation authoritative once the game doc update succeeds, even if the follow-up chat notification fails.

Current state:
- `edit-schedule.html` reports the entire cancel action as failed when `postChatMessage(...)` rejects.
- The schedule only refreshes after the chat write, leaving the cancelled game visible until a manual reload.

Proposed state:
- Treat `cancelGame(...)` as the success boundary for the user workflow.
- Refresh the schedule after a successful cancellation regardless of notification outcome.
- Surface chat notification failure as a separate, non-fatal error.

Risk surface and blast radius:
- Scope is limited to the cancel-game click handler in `edit-schedule.html`.
- No Firestore schema, rules, or backend behavior changes.

Assumptions:
- Chat notification failures are acceptable as best-effort follow-up work.
- An alert is an acceptable existing UX pattern for surfacing non-fatal notification errors on this page.

Recommendation:
- Split cancellation and chat notification error handling so only the first write controls success/failure of the cancel flow.
