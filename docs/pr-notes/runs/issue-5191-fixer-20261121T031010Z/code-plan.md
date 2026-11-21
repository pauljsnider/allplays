# Code plan

## Root cause

The normalized highlight list has no same-source reel helper, while `live-game.js` models only one active range. Its boundary handler can pause but cannot distinguish or advance a playlist.

## Patch sequence

1. Export `buildHighlightReelPlaylist(clips, { durationMs, replaySourceUrl })` from `js/live-game-video.js`; reuse `createHighlightClipDraft`, filter external media, sort deterministically, and avoid mutation.
2. Add start/stop/status controls to `live-game.html` and bump the `live-game.js` query version plus exact-version contract tests.
3. Import the helper in `js/live-game.js`; add local playlist/index/active state and control references.
4. Add derive/render/start/stop/complete/play-item helpers. Start only from the click handler and suppress URL history during reel transitions.
5. Extend the existing video `timeupdate` branch to advance or complete. Cancel the reel before individual selection/source switching.
6. Update every test stub fulfilling `live-game-video.js` with the new named export.
7. Add helper, DOM-harness, and focused mobile smoke regressions.

## Guardrails

Do not activate for embed or attached-clip-only playback, do not replace the canonical replay source during a reel, do not change stored records or sharing, and do not bypass existing paywall/entitlement resolution.
