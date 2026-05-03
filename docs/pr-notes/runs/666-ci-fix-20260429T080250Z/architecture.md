# Architecture Notes: PR #666 CI Fix

## Finding
`tests/unit/live-game-replay-init.test.js` builds `js/live-game.js` into an `AsyncFunction` after replacing browser imports with injected dependencies. PR #666 changed the `live-game-video.js` import to include `canAccessNativeCameraCapture` and bumped the cache-bust query to `?v=3`, but the test harness still rewrites only the old exact `?v=2` import.

Because the exact replacement misses, generated module source keeps an ES module import inside an `AsyncFunction`, causing `SyntaxError: Missing initializer in destructuring declaration` before assertions run.

## Minimal Safe Fix
Update the test harness import rewrite for `./live-game-video.js?v=<n>` so it tolerates cache-bust version changes and destructures the current imports from `deps.liveGameVideo`. Add `canAccessNativeCameraCapture: () => false` to the `liveGameVideo` dependency mock.

## Impact
Test-only change. No Firestore, Auth, Storage, tenant data, or production runtime behavior changes.

## Risks And Rollback
Risk is low and scoped to replay-init test dependency injection. Rollback is reverting `tests/unit/live-game-replay-init.test.js` and these notes.
