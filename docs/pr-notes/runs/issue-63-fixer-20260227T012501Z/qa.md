# QA Role Synthesis (fallback; subagent infra unavailable)

## Test Strategy
- Add a targeted unit test that guards the write-path contract:
  - Live append updates `notesLog`.
  - Live append does **not** update `notes`.
- Verify test fails against pre-fix behavior, then passes with fix.

## Regression Checks
- Existing static/planned notes continue rendering via `notes`.
- Text-note and voice-note flows both call same append path; contract covers both types.

## Commands
- `./node_modules/.bin/vitest run tests/unit/drills-live-practice-notes.test.js`
