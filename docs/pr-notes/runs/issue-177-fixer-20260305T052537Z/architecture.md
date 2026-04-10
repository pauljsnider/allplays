# Architecture Role (fallback synthesis)

## Current state
`team.html` fetches external standings via `fetchLeagueStandings(team.leagueUrl)` and renders snapshot only.

## Proposed minimal state
- Add pure JS standings engine module to compute rows from completed games.
- Support config object: ranking mode + points schema + ordered tiebreakers.
- Integrate in team page rendering path with feature flag on team object (`standingsConfig.enabled`).
- Keep external parser untouched as fallback path.

## Blast radius
- Low: additive module + localized team page rendering decision.
- No Firestore schema migration required for initial delivery; config stored as optional team fields.

## Controls
- Fail-closed fallback to existing external standings source.
- Pure function engine enables unit-level auditability.
