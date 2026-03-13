Objective: localize the fix to parent-dashboard practice-session reconciliation.

Current state:
- Parent dashboard has two independent reconciliation paths:
  1. Schedule assembly in `buildAllScheduleEvents()`
  2. Packet/attendance row assembly in `buildPracticePacketSessions()`
- Neither path has a reusable concept of "session linked to cancelled practice."

Proposed state:
- Introduce a small browser-safe ES module for practice-session visibility rules.
- Export a helper that inspects `practiceSession.eventId` against loaded practice docs:
  - direct cancelled practice match
  - cancelled recurring instance via `exDates`
- Use the helper in both parent dashboard paths.

Blast radius:
- One new JS helper module.
- One HTML page import update.
- Focused unit coverage only; no backend or schema changes.

Tradeoffs:
- `buildPracticePacketSessions()` will load `getGames(teamId)` so packet rows can honor schedule cancellation state.
- This adds a read per team for packet rendering, but keeps the implementation narrow and avoids speculative persistence changes.

Rollback:
- Revert the helper import and the two filter call sites.
- No data migration or stored-state cleanup required.
