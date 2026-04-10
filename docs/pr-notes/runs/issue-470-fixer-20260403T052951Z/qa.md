Test strategy:
- Browser spec 1: analyze mocked rows with one unmatched included home player, verify apply is blocked, map the row, apply, verify persisted writes and summary visibility.
- Browser spec 2: seed existing events and aggregated stats, reject overwrite confirm, verify no deletes or commit; accept confirm, verify deletes, rewritten saved data, and rendered game report tables.

Regression guardrails:
- Assert the exact alert/confirm paths.
- Assert `aggregatedStats` payload shape by player id.
- Assert `homeScore`, `awayScore`, `opponentStats`, and `status` persisted together.
- Assert saved data is consumed by `game.html`, not just stored in the mock layer.

Residual risks:
- This remains mocked-browser coverage, not live Firebase integration.
- AI extraction quality is still out of scope; the spec validates post-analysis review and persistence only.

Validation commands planned:
- `node_modules/.bin/playwright test tests/smoke/track-statsheet-apply.spec.js --config=playwright.smoke.config.js`
- `node_modules/.bin/vitest run tests/unit`
