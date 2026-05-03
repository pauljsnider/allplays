# QA

## Automated Coverage
- `hasPlayerProfileParticipation` includes explicitly marked all-zero appearances.
- `hasPlayerProfileParticipation` excludes all-zero unused roster aggregate docs without an appearance marker.
- `didNotPlay === true` overrides participation markers, time, and non-zero stats.
- Positive `timeMs` and non-zero stats continue to count.
- `buildTrackStatsheetApplyPlan` emits explicit participation fields for included zero-stat home rows.

## Manual Regression Plan
- Import a score sheet where an included mapped player has 0 points and 0 fouls. Confirm player profile games played includes the game and stats are zero.
- Confirm a roster player not included/mapped by the score-sheet import does not gain a game played.
- Confirm a DNP aggregate row does not increase games played.

## Release Gates
- `npx vitest run tests/unit/player-profile-stats.test.js tests/unit/track-statsheet-apply.test.js`
- `npm run test:unit`
- PR checks green after push.
