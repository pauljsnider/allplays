Objective: restore PR #497 unit-test stability with the smallest change.

Current state: `tests/unit/live-game-replay-init.test.js` rewrites `js/live-game.js` imports into injected dependency objects before evaluating the module source with `AsyncFunction`.
Proposed state: keep the production module unchanged and update the test harness so its rewrite logic matches the current `live-game-state` import contract.

Risk surface: test-only change, no runtime code path changes, no tenant or data-plane blast radius.
Assumptions: the CI failure is isolated to this brittle import-rewrite mismatch and no production behavior regression is implied by the log.

Recommendation: patch the test harness instead of `js/live-game.js` because the application import is valid and the failure only exists in the synthetic evaluation path.
