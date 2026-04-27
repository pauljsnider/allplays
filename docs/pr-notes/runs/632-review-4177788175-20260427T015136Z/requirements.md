# Requirements

## Objective
Active live games with a configured Twitch or YouTube stream must show the live feed first. Attached scored-play clips must not replace the active broadcast. Attached media clips must also play full length unless that exact clip has explicit bounds.

## Acceptance Criteria
- Active game plus configured live embed returns live embed playback before recorded replay or attached scored-play clips.
- Active replay/highlight URLs with `clipStart` / `clipEnd` still keep the live feed primary while the game is live.
- Attached clips remain available when no live feed is configured and for completed/replay workflows.
- Loading attached media clears stale clip bounds so previous highlight ranges do not truncate full-length media.
- Completed games continue to prefer recorded replay/highlight playback.

## User Impact
- Parents and fans keep the live game feed during game time.
- Coaches/admins avoid support churn caused by a clip hiding the broadcast.
- Post-game replay and score-linked clips remain usable after the game.

## Non-Goals
- No live-game viewer redesign.
- No Firestore schema, rules, provider, or upload-flow changes.
