# Architecture

## Architecture Decisions
- Reuse the existing `isSafeUrl` protocol gate already used for chat links.
- Add a narrow helper that wraps media hub highlight URL construction and returns `null` unless the URL passes the same safety check.
- Keep `buildMediaHubHighlightUrl` unchanged so existing share URL construction remains isolated.

## Risks And Rollback
- Risk is low: invalid or unsafe stored clip URLs stop rendering as playable/copyable links.
- Rollback is a single-file revert in `js/live-game.js`.

## Notes
- Role subagents were unavailable in this runtime, so architecture analysis was completed inline.
