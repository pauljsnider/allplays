# Code Role Notes

## Minimal Patch
Change `getPlayers(state.teamId, { includeInactive: true })` to `getPlayers(state.teamId, { includeInactive: state.isReplay })` in `init()`.

## Rationale
`state.isReplay` is set from URL params before data fetch. This cleanly gates inactive player inclusion to replay sessions.

## Validation
- `rg` confirmation of updated query option.
- `node --check js/live-game.js` syntax check.
- `git diff --stat` to confirm single-target code change plus run artifacts.
