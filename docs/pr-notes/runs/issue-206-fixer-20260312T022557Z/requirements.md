Objective: keep the cancel-game workflow truthful when the game write succeeds but follow-up team notification fails.

Current state:
- `cancelGame(...)` is already treated as the source-of-truth write.
- `postChatMessage(...)` failure is surfaced as a partial-success warning.
- The schedule refresh is triggered but not awaited before the warning alert, so the user can still see stale pre-cancel UI during the exact failure path.

Proposed state:
- Successful cancellation should finish refreshing the schedule before the UI surfaces any partial-success warning.

Risk surface and blast radius:
- Limited to the cancel button flow in `edit-schedule.html`.
- No data model, permission, or backend behavior changes.

Assumptions:
- `loadSchedule()` remains the canonical way to repaint the schedule after a mutation.
- Showing the cancelled state before the warning is better than warning first and leaving stale UI visible.

Recommendation:
- Await the schedule reload after any successful cancellation, including chat-notification failure.
- Keep cancellation success and notification failure as separate outcomes.

Success measure:
- When the chat write fails after cancellation succeeds, the game still shows as cancelled before the warning alert appears.

Note:
- The requested orchestration skills and `sessions_spawn` workflow were not available in this environment, so the role synthesis for this run was completed locally and recorded in these artifacts.
