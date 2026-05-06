# Code Plan

## Implementation Plan
- Add `buildSafeMediaHubHighlightUrl(clip)` beside existing media hub URL construction.
- Use the safe helper when rendering media hub highlight anchors.
- Use the same safe helper in the media hub Copy click handler.
- Avoid unrelated refactors or broad URL policy changes.

## Notes
- Role subagents were unavailable in this runtime, so code planning was completed inline.
