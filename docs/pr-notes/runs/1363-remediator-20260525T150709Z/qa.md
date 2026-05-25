# QA

## QA Plan
- Add/keep a unit regression test that reads `track-live.html` and verifies `cancelGame` does not query/delete `liveEvents`.
- Verify cancel reset still writes scheduled status and clears live tracking fields.
- Run the focused unit test: `npx vitest run tests/unit/track-live-state.test.js --reporter=verbose`.
