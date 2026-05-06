# Code Plan

1. In `track-live.html`, locate `logFootballPlay(playType)`.
2. Keep the existing guard that prevents football play recording before the timer has ever started.
3. Remove only the `if (gameState.isRunning)` wrapper around the `broadcastLiveEvent(...)` call.
4. Leave the payload, `scheduleLiveHasData()`, and possession toggle logic unchanged.
5. Validate with `git diff`, targeted grep, and a syntax parse of the script content if feasible.
