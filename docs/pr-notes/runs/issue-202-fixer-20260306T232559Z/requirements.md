# Requirements Role (synthesized fallback)

Skill/tool note: `allplays-orchestrator-playbook` and the named role subagent skills are not installed in this runtime, so this role output is synthesized directly in the main lane.

## Objective
Add a minimal archived game-video replay flow for completed games and let users create bounded 60-second highlight clips without introducing backend video-processing infrastructure.

## Current State
- `live-game.html` only shows a video panel when a live external embed exists.
- Replay mode rehydrates play-by-play, chat, and reactions only.
- There is no user-facing clip selection or saved highlight entry point.

## Proposed State
- Completed/replay games can render a true archived video player when the game document includes recorded video metadata.
- Users can define a start and end range capped at 60 seconds, generate/share a clip link, and view saved highlight metadata when present on the game document.
- Saving should be best-effort and low blast-radius: store clip metadata only, no transcoding or media duplication.

## Assumptions
- Recorded video assets are already hosted elsewhere and exposed as safe URLs on the game document.
- Clip persistence can be represented as metadata on the game document for now.
- If save permissions are unavailable for a viewer role, link sharing still provides value and avoids blocking replay.

## Success Criteria
- Replay pages show archived video when metadata exists.
- Clip selection enforces a 60-second maximum.
- Saved clips are normalized and rendered consistently.
