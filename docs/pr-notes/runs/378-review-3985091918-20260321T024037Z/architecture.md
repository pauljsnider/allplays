Decision: keep reconciliation ownership in `buildFinishCompletionPlan()` so all finish outputs derive from one effective log.

Why:
- The helper already owns final-score reconciliation and downstream outputs (`eventWrites`, `gameUpdate`, `navigation`).
- Centralizing the reconciliation note there avoids drift between persisted events, recap generation, and UI follow-up.

Control comparison:
- Previous behavior: UI-only note after commit, no durable explanation in saved events or email.
- New behavior: note is included in the helper’s effective log before event and recap artifacts are created, then echoed to the live UI after commit.

Blast radius:
- `js/live-tracker-finish.js` only.
- `js/live-tracker.js` only for wiring current period/clock and using the helper-provided note.

Fallback path:
- If further reconciliation metadata is needed later, extend the helper return shape rather than rebuilding log mutations in `live-tracker.js`.
