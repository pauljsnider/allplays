# Architecture Notes

## Acceptance Criteria
- Unit test suite parses and executes `tests/unit/live-game-replay-init.test.js`.
- The replay init harness continues to load `js/live-game.js` through dependency injection without importing browser/Firebase modules directly.

## Architecture Decisions
- Keep the existing source-rewrite harness and update only the stale `live-game-video.js` import rewrite.
- Match the import by versioned regex so future cache-bust-only changes do not break the harness.
- Add the new `canAccessNativeCameraCapture` dependency stub because `js/live-game.js` now imports it from `live-game-video.js`.

## Risks And Rollback
- Risk is limited to the unit test harness. Runtime application code is unchanged.
- Rollback is to revert the test harness import rewrite and stub additions.
