## Requirements role

- Objective: ensure live tracker resume restores the correct clock when only legacy game-doc fields (`period`, `gameClockMs`, `clock`) exist.
- Current state: production code already passes legacy keys into `deriveResumeClockState`, but the regression test relies on source-text inspection rather than the runtime game-doc shape.
- Proposed state: cover the real mapping path from `currentGame` into persisted resume state so the fallback stays reachable in production behavior.
- Risk surface: live tracker resume only. No auth, tenant, or cross-team data blast radius change.
- Acceptance criteria:
  - A legacy-only game doc restores `Qx` and millisecond clock through the same mapping production uses.
  - Existing liveClock resume behavior remains unchanged.
  - Focused resume tests pass.
