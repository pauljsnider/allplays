# Requirements Role (fallback synthesis)

## Objective
Deliver native standings from internal game data with configurable ranking mode and ordered tiebreakers, while preserving existing external `leagueUrl` behavior as fallback.

## User-facing requirements
- Team admin can configure standings behavior in team settings:
  - ranking mode: `points` or `win_pct`
  - ordered tiebreakers list
- Team page shows standings computed from internal finalized games when native standings is enabled.
- If native standings is not enabled or no internal data is available, continue existing external standings snapshot behavior.

## Acceptance criteria
- Deterministic standings order for identical inputs.
- Ranking mode affects primary sort key.
- Ordered tiebreakers are applied in provided order.
- Existing external standings flow remains intact.
