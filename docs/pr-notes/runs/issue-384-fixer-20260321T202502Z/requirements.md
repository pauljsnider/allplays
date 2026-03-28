Objective: Verify replay startup applies the same chat lockout controls for completed games whether replay events exist or not.

Current state: `live-game.js` disables replay chat only in the populated replay-data branch.
Proposed state: replay startup sets the replay chat-disabled UI consistently before any replay branch can return.

Risk surface: completed-game viewer path from `Watch Replay`; blast radius is limited to replay initialization on `live-game.html`.

Assumptions:
- Replay viewers should never have an enabled chat box.
- The no-events replay path should still show completed-game scores from the loaded game document.

Recommendation: add DOM-oriented replay-init tests for both replay branches, then apply the smallest startup fix that preserves existing live-mode chat behavior.
