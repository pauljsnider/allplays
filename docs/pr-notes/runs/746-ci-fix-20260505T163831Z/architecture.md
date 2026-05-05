# Architecture Notes

## Root cause
PR #746 added a `team-entitlements.js` import to `js/live-game.js`. The replay init unit test evaluates `live-game.js` by rewriting ES module imports into dependency destructuring before passing the source to `AsyncFunction`.

The test harness did not rewrite the new `team-entitlements` import. Its broad `live-game-state` import regex then consumed across the leftover import boundary and generated invalid destructuring, producing `SyntaxError: Missing initializer in destructuring declaration` before any assertions ran.

## Minimal fix
Update `tests/unit/live-game-replay-init.test.js` only:
- Add an explicit rewrite for the `team-entitlements.js` import before the broad `live-game-state` rewrite.
- Add a `deps.teamEntitlements` mock object for the rewritten dependency.

## Risk and blast radius
Production blast radius is none because the change is test harness only. The main residual risk is future import drift in `js/live-game.js` breaking this dynamic source-rewrite harness again.

## Rollback
Revert the test harness changes in `tests/unit/live-game-replay-init.test.js`.
