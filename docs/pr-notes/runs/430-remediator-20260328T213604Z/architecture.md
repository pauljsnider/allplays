Decision: keep the fix inside `window.undoLogEntry` in `track-live.html`.

Why:
- The bug originates where local clamping and live-event emission diverge.
- A local variable for the effective undo delta keeps the change minimal and reviewable.

Controls:
- No schema changes.
- No changes to broadcast consumers.
- Existing live event shape is preserved; only `value` becomes accurate.
