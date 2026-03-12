Test focus:
- Resume with no usable live-event clock but persisted game doc clock present.
- Legacy game-doc field compatibility.
- No regression for existing `liveClock*` path.

Primary regression case:
- Given empty/non-clock live events
- And defaults initialized to `Q1` / `0`
- And persisted game data only includes `period: 'Q3'` and `gameClockMs: 187000`
- Resume returns restored `Q3` / `187000`

Secondary guardrail:
- Existing modern-field test remains valid for `liveClockPeriod` / `liveClockMs`.

Relevant command:
- `node node_modules/vitest/vitest.mjs run tests/unit/live-tracker-resume.test.js`
