Current state
- `sendMessage()` in `team-chat.html` uploads all pending media before calling `postChatMessage(...)`.
- The reviewed commit used `Promise.all(...)`, which can leave earlier successful uploads orphaned if any later upload rejects.

Proposed state
- Sequentialize uploads inside `sendMessage()` and accumulate successful payloads in `mediaPayloads`.
- On any exception after at least one successful upload, call `deleteUploadedChatAttachments(mediaPayloads)` in the catch block before surfacing the existing send error.

Why this path
- Smallest viable change with contained blast radius.
- No data model changes, no backend contract changes, no new persistence state.
- Preserves existing UX: users still see one send error, but storage is cleaned up best-effort first.

Controls
- Auditability remains with existing storage paths and message writes.
- Blast radius is reduced versus the reviewed code because failed sends no longer retain unreferenced media by default.

Tradeoff
- Cleanup is best-effort. If cleanup itself fails, the UI logs the cleanup error and still reports the send failure. That is acceptable for this patch and preferable to masking the original failure.
