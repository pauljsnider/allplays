# Code Role Plan (synthesized fallback)

Skill/tool note: `allplays-code-expert` subagent spawn unavailable; synthesized here.

## Planned Edits
1. Add `tests/unit/live-game-video.test.js` covering archived replay source selection, highlight normalization, and clip-link generation.
2. Add `js/live-game-video.js` with pure helpers for replay-video resolution and highlight clip clamping.
3. Update `live-game.html` to host both native replay video and embed fallback UI.
4. Update `js/live-game.js` to render archived video, handle clip selection/share/save, and read saved highlight metadata.

## Validation
- Run the new targeted unit file first to prove failure.
- Run the targeted file again after the fix, then run the broader live-game-related unit set.
