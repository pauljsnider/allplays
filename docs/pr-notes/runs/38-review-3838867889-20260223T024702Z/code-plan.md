# Code Role Notes

## Plan
- Remove high-risk table selector regex in `parseTeamSidelineStandings`.
- Add `collectTableHtml` and `findStandingsTable` helpers using linear scanning.
- Add tests for single-quoted ids and large non-table payload handling.

## Conflict Resolution
- Requirements asked for behavior parity.
- Architecture prioritized deterministic parse steps.
- QA required regression guardrails and explicit safety coverage.
- Final implementation keeps output contract unchanged while removing regex DoS surface.
