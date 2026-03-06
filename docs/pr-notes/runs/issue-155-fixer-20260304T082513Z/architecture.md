# Architecture Role Synthesis

## Current state
- `track-live.html` holds tracker logic inline and does not publish a reset semantic event to viewers.
- `live-game.js` is append-only for event processing and does not handle state reset events.
- `live-game.js` forcibly injects `FLS` into display columns.
- Opponent display relies on `game.opponent` first, causing linked-opponent name misses.

## Proposed state
- Introduce tiny shared helper modules:
  - `js/live-game-state.js` for opponent name resolution, stat column normalization, and reset-state projection.
  - `js/live-tracker-field-status.js` for player on-field/bench state + elapsed time accounting.
- Use `reset` live event from tracker and consume it in viewer to clear viewer state in-session.
- Keep `liveLineup` shape (`onCourt`, `bench`) for compatibility, but update UI copy to generic language.

## Risk and blast radius
- Blast radius limited to `live-game` and `track-live` pages plus new helper modules.
- Firestore document updates remain on existing fields (`liveLineup`, scores, period, opponent fields).
- Main risk is inline-script integration regressions in `track-live.html`; mitigated by unit tests for helper logic and targeted manual flow checks.
