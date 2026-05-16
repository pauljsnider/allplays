# Code Plan

## Minimal change
Update `tests/smoke/team-fallback-regressions.spec.js` stubs:
- Add `uploadTeamMediaFile()` to media db stubs.
- Add `isTeamMediaDocument()` and `isSupportedTeamMediaDocument()` to media utility stubs.

## Scope
No production code changes. This is CI test drift caused by stale smoke module stubs.
