# Architecture Role (manual fallback)

- Thinking level: medium (cross-file behavior consistency).

## Current state
- Stream normalization logic was embedded in `edit-team.html` and discarded embed query state.
- Visibility logic in `js/live-game.js` had two competing controllers (`setupVideoPanel` and `updateTabs`) with no shared source of truth for stream presence.

## Proposed state
1. Introduce `js/live-stream-utils.js` as shared pure utility layer:
   - `normalizeYouTubeEmbedUrl(url)` preserves query params and enforces `autoplay=1&mute=1`.
   - `computePanelVisibility(...)` centralizes panel/tab visibility decisions.
2. Use the shared utility in both `edit-team.html` and `js/live-game.js`.
3. Store `state.hasVideoStream` in live-game runtime and drive tab/layout from it.

## Blast radius
- Scoped to stream parsing and live-game panel visibility; no Firestore schema or auth/rules changes.
