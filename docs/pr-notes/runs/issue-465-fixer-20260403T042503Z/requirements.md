Objective: add regression coverage proving cancelled imported ICS events stay visible in Edit Schedule but do not expose Track or Plan Practice actions.

Current state:
- `edit-schedule.html` renders imported calendar rows and suppresses action buttons when `event.isCancelled` is true.
- `js/utils.js::parseICS` preserves `STATUS` and `SUMMARY`, but tests do not pin cancelled parsing.
- Existing tests cover normal imported game/practice flows, not cancelled external events.

Proposed state:
- Unit coverage proves `parseICS()` preserves cancelled ICS data for both `STATUS:CANCELLED` and `[CANCELED]` summary variants.
- Browser coverage proves cancelled imported game and practice rows render as cancelled, keep struck-through styling, and hide Track / Plan Practice actions.

Assumptions:
- Cancelled imported events should remain visible for schedule awareness.
- Non-actionable means the action-button block is absent, not disabled.
- TeamSnap-style `[CANCELED]` summaries are a supported input shape.

Risk surface and blast radius:
- Limited to imported calendar event parsing and Edit Schedule rendering.
- No Firestore schema or live tracking behavior changes.
- Regression risk is coach-facing schedule UI only.

Success measure:
- New unit and browser tests fail without the fix and pass with it.
- Imported cancelled game/practice rows show a Cancelled badge and no action controls.
