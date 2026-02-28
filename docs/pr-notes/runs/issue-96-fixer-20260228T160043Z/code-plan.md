# Code role synthesis (fallback; requested skill unavailable)

## Minimal patch
1. Add `js/live-tracker-resume.js` with pure resume derivation helper.
2. Add `tests/unit/live-tracker-resume.test.js` covering latest-event restore + fallback logic.
3. Wire helper into `js/live-tracker.js` resume path and apply `setPeriod(state.period)` during init.

## Non-goals
- No refactor of broader live tracker state machine.
- No changes to scoring aggregation logic beyond necessary `liveEvents` availability.
