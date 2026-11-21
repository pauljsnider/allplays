# Architecture analysis

## Root cause and current flow

`normalizeSavedHighlightClips` produces a mixed list of replay ranges and standalone clips. `applyHighlightSelection` installs one range in `state.videoPlayback`, and the recorded video's `timeupdate` listener pauses at that range end. There is no derived same-source playlist, reel state, advancement branch, or progress UI.

## Minimal design

- Add a pure `buildHighlightReelPlaylist` helper that revalidates/clamps ranges, preserves normalized order, excludes standalone/different-source media, and returns fresh objects.
- Keep execution in viewer-local state in `js/live-game.js`; do not mutate or persist game data.
- Add start, stop, and polite live-status controls in the Archived Replay panel.
- Start only from a user click. Apply reel selections with history updates disabled.
- Extend the existing `timeupdate` listener: advance when another reel item exists, complete at the final boundary, and retain the old single-highlight pause behavior when no reel is active.
- Cancel reel state before individual highlight loads or source changes.
- Recompute eligibility after replay metadata/source changes.

## Authorization and invariants

- Build a reel only after an authorized native recorded replay is present.
- Do not offer the reel for embed, attached-clip-only, processing, unavailable, failed, or gated playback.
- Preserve external clips and their individual links; only the derived playlist filters them.
- Active reel state always has a valid playlist/index and the same canonical replay source.
- Stop and completion are idempotent and remove automatic advancement.

## Risks

Mixed sources, stale range boundaries, duplicate listeners, entitlement regression, and history churn are controlled by pure filtering, one existing listener, explicit teardown, authorized-playback gating, and `updateHistory: false`.
