# Code Plan

## Root Cause
- `team.html` now imports additional helpers (`postChatMessage`, tournament standings, roster field privacy, availability preferences, and schedule notifications), while this smoke fixture only mocked a subset of modules.
- In CI that drift left the page boot path incomplete, so `#team-header` and `#schedule-list` retained their initial whitespace placeholders.

## Implementation Plan
- Add minimal no-op/default exports for the imported helpers in `tests/smoke/team-schedule-calendar.spec.js`.
- Route those current `team.html` helper modules to the stubs during the smoke test.

## Validation
- Run the affected Playwright smoke spec.
