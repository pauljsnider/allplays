# Code Plan

## Patch
- Update `js/live-game-video.js` so `resolveReplayVideoOptions()` detects active games and returns configured live embeds before recorded or attached media.
- Add regression coverage in `tests/unit/live-game-video.test.js` for active replay links with attached clips and clip bounds.

## Existing Guardrail Confirmed
- `js/live-game.js` already clears `state.clipStartMs`, `state.clipEndMs`, `state.videoPlayback.clipStartMs`, and `state.videoPlayback.clipEndMs` when loading attached scored-play media.

## Validation
Run focused unit tests, syntax checks, and diff whitespace checks before commit.
