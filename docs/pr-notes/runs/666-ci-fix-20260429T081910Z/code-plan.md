# Code Plan

## Implementation Plan
- Update the replay init test harness to rewrite the current `live-game-video.js` import, including `canAccessNativeCameraCapture` and version-tolerant cache busting.
- Add a no-op `canAccessNativeCameraCapture` dependency stub to the mocked `liveGameVideo` module.
- Do not change production code.
