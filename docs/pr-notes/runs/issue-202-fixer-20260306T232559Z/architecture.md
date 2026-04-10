# Architecture Role (synthesized fallback)

Skill/tool note: `allplays-architecture-expert` subagent spawn unavailable; synthesized here.

## Root Cause
The live-game page has a single video-panel setup path that only understands live Twitch/YouTube embeds. Replay mode never resolves archived game-video metadata, so completed games cannot render in-product video replay or clip controls.

## Minimal Safe Change
- Add a pure helper module that:
  - resolves archived replay-video metadata from the game document
  - falls back to existing live embed behavior
  - normalizes saved highlight clips and clamps ranges to 60 seconds
  - builds shareable clip links
- Extend `live-game.html` with a native `<video>` element and a lightweight highlight editor in the existing video panel.
- Wire `live-game.js` to use the helper, render saved clips, and perform metadata-only saves through `updateGame`.

## Blast Radius
- Primary files: `js/live-game.js`, `live-game.html`, new helper module, and unit tests.
- No Firestore rules or schema migrations.
- Data writes are optional and limited to one top-level game field (`highlightClips`).

## Rollback
- Revert the helper/UI additions and the page returns to the prior live-embed-only behavior.
