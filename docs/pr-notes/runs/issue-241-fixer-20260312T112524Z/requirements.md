Objective: restore the true in-progress live tracker period and clock when a user chooses "Continue where you left off."

Current state:
- Scores, stats, and some lineup state resume.
- Clock context can fall back to a fresh session baseline.

Proposed state:
- Resume restores period and elapsed clock from persisted game state even when only legacy clock fields are present.

Risk surface:
- Resume logic for existing live basketball sessions.
- Blast radius is limited to live tracker re-entry and only affects state restoration.

Assumptions:
- Some existing games were saved with legacy clock fields (`period`, `clock`, `gameClockMs`) rather than only `liveClockPeriod`/`liveClockMs`.
- Users expect "continue" to preserve game context, not just score totals.

Recommendation:
- Preserve the existing resume flow and extend persisted clock fallback compatibility instead of refactoring tracker init.
- Add regression coverage for legacy persisted game clock fields.

Success measure:
- Choosing continue restores `Q3`/`3:07`-style state from persisted game metadata with no live-event clock required.
