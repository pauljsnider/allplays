# Code role plan (Issue #227)

## Objective
Implement a minimal safe post-game insights feature with focused test coverage and no backend schema changes.

## Planned Edits
- Add pure helper module:
  - `js/post-game-insights.js`
- Add focused unit tests:
  - `tests/unit/post-game-insights.test.js`
- Update report page to render:
  - team insights
  - player insight cards
  - empty-state messaging
- Update player page to render selected-game insights when `gameId` is present

## Success Criteria
- Insights are deterministic and sourced from existing game data.
- Tests cover both team-level and player-level insight generation.
- Existing report/player pages continue to function when no insight data exists.
