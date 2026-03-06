# Requirements Role Notes

## Objective
Address unresolved PR thread `PRRT_kwDOQe-T585xUbvI` by ensuring inactive players are included in live-game roster loading only for historical replay sessions.

## Evidence
- Review feedback points to `js/live-game.js` roster query regression where inactive players can appear in active workflows.
- `live-game.html` is used for both live and replay contexts.

## Requirement
- Replay mode (`replay=true`) must include inactive players.
- Non-replay live mode must use active roster only.
- Keep change minimal and scoped to this thread.
