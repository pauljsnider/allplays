# QA Role (fallback synthesis)

## Test strategy
- Unit tests for standings engine sorting behavior:
  - rank by points mode
  - rank by win percentage mode
  - ordered tiebreaker precedence
  - deterministic fallback ordering
- Regression check existing `league-standings.test.js` external parser tests.

## Manual validation
- Team page with `standingsConfig.enabled=true` and sample completed games shows internal standings.
- Team page with disabled config still uses external standings card/link.

## Risks
- Historical game docs may have missing/variant score fields.
- Tie logic can regress silently without tests; require explicit tiebreaker coverage.
