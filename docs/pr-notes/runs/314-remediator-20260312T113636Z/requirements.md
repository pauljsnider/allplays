Objective: fix PR #314 review thread PRRT_kwDOQe-T585z2IlB by making the live tracker resume flow restore legacy persisted clock fields in production.

Current state:
- `deriveResumeClockState()` accepts modern `liveClock*` fields and legacy `period` / `gameClockMs` / `clock`.
- `live-tracker.js` only passes `{ liveClockPeriod, liveClockMs }` during resume.
- Result: games saved with only legacy clock fields resume to the default `Q1 0:00`.

Required change:
- Pass both modern and legacy persisted clock fields from `currentGame` into `deriveResumeClockState()`.
- Add regression coverage for the real caller shape, not only the helper fallback.

Blast radius:
- Limited to live tracker resume initialization.
- No data model changes.
