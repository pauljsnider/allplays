Decision: add a lightweight gate ahead of `setupVideoPanel` instead of refactoring the player stack.

Reasoning:
- The existing `shouldReloadVideoPlayback` helper already defines the reload boundary as mode or source changes.
- Reusing that helper in the live snapshot path keeps behavior consistent and minimizes blast radius to `js/live-game.js`.

Blast radius:
- Affects live-game viewer updates only.
- Does not change replay option resolution, saved highlight behavior, or Firestore subscriptions.
