# QA Role (synthesized fallback)

Skill/tool note: `allplays-qa-expert` subagent spawn unavailable; synthesized here.

## Regression Guardrails
- Unit coverage should prove archived replay video wins over live embed inputs during replay.
- Unit coverage should prove clip ranges are clamped to 60 seconds and invalid saved clips are ignored.
- Manual validation should confirm the existing live embed path still renders when no archived replay asset exists.

## Manual Validation Targets
1. Open a completed game with `replayVideoUrl` or `replayVideo.url` and verify a native video player appears.
2. Create a clip with a range longer than 60 seconds and confirm it is capped.
3. Save a highlight as an authorized user and confirm it appears in the saved highlight list.
4. Open the generated clip link and confirm playback starts at the clip start and stops at the clip end.
