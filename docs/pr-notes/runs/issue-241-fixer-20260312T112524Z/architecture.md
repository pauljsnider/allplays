Decision: patch `deriveResumeClockState()` to accept both current and legacy persisted clock field names from the game doc.

Current state:
- Resume helper reads `liveClockPeriod` and `liveClockMs`.
- If live events do not contain usable clock data and only legacy fields exist, helper returns defaults.

Proposed state:
- Resume helper normalizes persisted fields from:
  - `liveClockPeriod` / `liveClockMs`
  - `period` / `gameClockMs`
  - `period` / `clock`

Why this path:
- Smallest change with low blast radius.
- Keeps the main page flow intact and centralizes compatibility logic in the existing helper.
- Avoids duplicating field probing in `live-tracker.js`.

Rollback:
- Revert helper change and regression test if resume behavior regresses.

Instrumentation gap:
- No automated telemetry here. Unit regression test is the guardrail.
