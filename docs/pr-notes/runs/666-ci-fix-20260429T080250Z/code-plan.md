# Code Plan: PR #666 CI Fix

## Root Cause
`tests/unit/live-game-replay-init.test.js` rewrites `js/live-game.js` imports into injected dependencies before evaluating with `AsyncFunction`. The `live-game-video.js` import changed to `?v=3` and added `canAccessNativeCameraCapture`, while the test still matched only the old exact `?v=2` import. The import remained in generated function source and caused CI to fail at parse time.

## Patch
- Update only `tests/unit/live-game-replay-init.test.js`.
- Replace brittle exact-string `live-game-video.js?v=2` rewrite with a scoped regex matching `./live-game-video.js?v=<n>`.
- Inject all imported names from `deps.liveGameVideo`.
- Add `canAccessNativeCameraCapture: () => false` to the `deps.liveGameVideo` mock.

## Validation
Run the targeted replay-init test first, then adjacent replay/chat tests or the full unit CI command if time allows.
