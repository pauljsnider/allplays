## Role
Architecture synthesis fallback for issue #256.

## Current State
- `edit-schedule.html` performs `cancelGame(...)` and `postChatMessage(...)` in one `try/catch`.
- A later chat write failure collapses the entire flow into an incorrect cancellation error.

## Proposed State
- Introduce a tiny orchestration helper in `js/` that:
  - runs the cancellation write first
  - attempts the notification write second
  - returns structured outcome metadata for the caller
- Keep Firestore write helpers unchanged; only adjust orchestration and UI messaging.

## Risk Surface
- Low blast radius: one page handler and one new helper module.
- No schema, rules, or backend changes.
- Main regression risk is changing alert/load behavior for the success path; cover it with a unit test.
