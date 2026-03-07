Primary regression to cover:
- Resume with no usable live events but with `liveClockPeriod/liveClockMs` on the game doc must restore that clock state.

Guardrails:
- Existing event-based resume tests must still pass.
- Invalid persisted values must still fall back to defaults.
- Fresh reset flow must not change.

Validation plan:
- Add a unit test for game-doc fallback in `tests/unit/live-tracker-resume.test.js`.
- Run the targeted resume test file first, then the full unit suite.
