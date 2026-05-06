# QA Plan

## Automated Coverage
- `tests/unit/live-game-video.test.js`: active replay/highlight links with attached clips and configured YouTube live feed return embed mode and clear clip bounds.
- Existing coverage verifies completed games still return recorded replay, attached clips work when no replay video exists, and active non-replay games keep live embed visible.
- `tests/unit/live-game-attach-clip-ui.test.js`: verifies attached clip load path clears `state.clipStartMs` and `clipEndMs`.

## Commands
- `npm ci`
- `npx vitest run tests/unit/live-game-video.test.js tests/unit/live-game-attach-clip-ui.test.js --reporter=dot`
- `node --check js/live-game-video.js`
- `node --check js/live-game.js`
- `git diff --check`

## Manual Checks
- Active game plus YouTube/Twitch stream plus attached clip: live embed visible, attached clip does not replace stream.
- Completed game replay: recorded video and saved highlights still load.
- Highlight URL followed by attached media: attached media is not truncated by stale bounds.

## Risks
- Direct active-game deep links to clips now prioritize the live feed. This is intentional for the active broadcast workflow.
