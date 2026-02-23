# Code Role Notes (League Link + Standings)

## Objective
Implement league URL capture and standings display with test coverage.

## Code Changes
- Added `leagueUrl` field in team editor form and save/load flow:
  - `edit-team.html`
- Added standalone standings module:
  - `js/league-standings.js`
  - Parses TeamSideline standings table with W/L/T/PCT/PF/PA/PD extraction.
  - Provides matching helper and resilient fetch strategy (direct + proxy fallback).
- Integrated standings display into team page:
  - `team.html`
  - Adds league link badge in header.
  - Adds "League Standings" season overview card.

## Tests Added
- `tests/unit/league-standings.test.js`
  - parser extraction of W/L/T row values
  - normalization/matching behavior
  - no-table fallback behavior

## Success Criteria
- Team settings persist `leagueUrl`.
- Team page shows league standings when URL is configured.
- Unit tests pass for parser/matching logic.
