# Architecture

## Decision
Move active-game live embed precedence ahead of recorded/attached media selection in `resolveReplayVideoOptions()`.

## Current State
`resolveReplayVideoOptions()` can choose recorded media first when `isReplay` is true, which lets an attached scored-play clip or replay URL hide a configured live stream during an active game.

## Proposed State
- Detect completed and active game states before playback selection.
- Resolve live embed early only for active games.
- Return embed mode with `clipStartMs` and `clipEndMs` cleared when an active live embed exists.
- Preserve recorded replay precedence for completed games.
- Preserve attached clip fallback when no live embed is configured.

## Blast Radius
Client-only playback selection for `live-game.html`. No persisted data, rules, auth, or upload changes.

## Rollback
Revert the `js/live-game-video.js` resolver change and its unit test. Static asset rollback only.
