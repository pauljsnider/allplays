Current state:
- `js/live-game.js` owns replay bootstrap, replay ticking, DOM updates, and Firestore wiring in one module.
- `js/live-game-replay.js` already contains pure replay timing helpers and is the lowest-risk place to add more replay-specific logic.

Proposed state:
- Extract pure replay-session helpers into `js/live-game-replay.js` for:
  - replay bootstrap normalization for completed games
  - deterministic collection of replay events, chat, and reactions at a target elapsed time
- Keep `js/live-game.js` behavior the same except for routing replay setup through helpers and applying the replay-mode chat lock consistently.

Risk surface:
- Low blast radius. Changes stay within live-game replay logic and unit tests.
- Main regression risk is changing replay bootstrap defaults. Mitigation is explicit assertions around no-event fallback and timeline ordering.
