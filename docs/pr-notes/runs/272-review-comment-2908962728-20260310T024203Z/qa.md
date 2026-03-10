## QA role summary

- Regression targeted: completed-game scoring events saved with top-level `statKey`/`value` and top-level `isOpponent`.
- Coverage added:
  - team insight test now uses persisted top-level scoring events for both home and opponent late-game plays
  - player insight test now uses persisted top-level scoring events for closing-presence generation
- Validation command:
  - `node /home/paul-bot1/.openclaw/workspace/allplays/node_modules/vitest/vitest.mjs run tests/unit/post-game-insights.test.js`
- Result: `3/3` tests passed.
