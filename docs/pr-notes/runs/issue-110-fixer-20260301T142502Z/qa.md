# QA Role (manual fallback)

Required allplays orchestration skills/subagent tooling were requested but are unavailable in this runtime, so this is a manual role synthesis artifact.

## Test strategy
- Add failing-first unit test in `tests/unit/parent-dashboard-rsvp.test.js`:
  - Given broad `childIds` payload containing multiple children
  - And selected child filter context
  - Expect output to include only selected child.

## Regression checks
- Existing RSVP scope tests still pass:
  - explicit childId
  - explicit childIds sanitization
  - reject out-of-scope childId
  - game-scope fallback

## Manual sanity checks (optional)
- Parent dashboard list and calendar/day modal RSVP buttons under selected player filter.
