# QA Plan

## Automated
- Run targeted unit tests for officiating helpers: `npm test -- --run tests/unit/officiating-utils.test.js`.

## Manual
- In `edit-schedule.html`, create or edit a game with an official assigned.
- Ensure an overlapping cancelled game with the same official exists in the cache.
- Save should not show the conflict confirmation for the cancelled game.
- Confirm an overlapping active game with the same official still shows the warning.

## Regression Focus
- Back-to-back active assignments still warn.
- Editing the same game still does not warn against itself.
