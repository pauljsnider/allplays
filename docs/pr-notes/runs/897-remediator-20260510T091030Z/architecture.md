# Architecture notes

- Keep source of truth in `state.videoPlayback`: compare the active `sourceUrl` with `state.videoPlayback.mediaHub.replay.sourceUrl` before allowing replay-relative seeks.
- Add a small URL equivalence helper near the media-hub highlight helpers to avoid brittle exact-string mismatches for absolute/relative URLs.
- Do not change `resolveReplayVideoOptions` routing or saved-highlight normalization in this remediation.

## Risks and rollback

- Risk: over-restricting playback if provider URLs differ only by normalization. Mitigate by comparing URL hrefs via `new URL(..., window.location.href)` with a string fallback.
- Rollback: revert the helper and `canPlayMediaHubHighlight` gate.
