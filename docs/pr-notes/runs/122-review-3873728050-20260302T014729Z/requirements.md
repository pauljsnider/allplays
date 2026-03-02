# Requirements Role (manual fallback)

- Thinking level: medium (targeted regression fixes with user-visible impact).
- Constraint: preserve existing valid live-stream configs during unrelated team edits.

## Problem framing
1. `parseStreamUrl()` was stripping all query params from existing YouTube embed URLs.
2. Live game desktop tabs were re-showing `#video-panel` even when no stream exists.

## Acceptance criteria
1. Saving a team that already has `streamEmbedUrl` using `/embed/live_stream?channel=UC...` must keep `channel` after normalization.
2. Desktop live-game layout must hide `#video-panel` when no stream is configured.
3. Mobile tab behavior must not allow a dead `video` tab when no stream exists.
4. Add automated checks for both regressions.
