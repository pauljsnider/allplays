Root cause: the tracker persists clock state in two places, but resume only consumes one of them.

Evidence:
- `syncClockToGameDoc()` writes `liveClockPeriod`, `liveClockMs`, and `liveClockUpdatedAt` to the game document.
- Resume calls `deriveResumeClockState(liveEvents, defaults)` and ignores the game doc clock fields.
- If live events are absent, delayed, or incomplete, resume falls back to defaults even though the game doc contains usable clock state.

Minimal safe patch:
- Extend the resume helper to accept a persisted game-doc fallback.
- Keep precedence as: valid live event state first, persisted game-doc state second, defaults last.

Blast radius:
- Limited to live tracker resume state selection.
- No schema changes, no Firestore write-path changes, no viewer changes.
