# Requirements Role Notes

## Objective
Keep inactive players visible for historical replay identity resolution, while preventing them from appearing in active live-game roster contexts.

## Current State
`live-game.js` always calls `getPlayers(teamId, { includeInactive: true })`, regardless of mode.

## Proposed State
Only include inactive players when the page is explicitly in replay mode (`replay=true`).

## Risk Surface / Blast Radius
- Low blast radius: isolated to player query options on `live-game.html` init.
- Primary risk: historical non-replay flows could exclude inactive players.
- Mitigation: scope requirement strictly to replay mode as requested by review feedback.

## Assumptions
- Replay links include `replay=true` in URL.
- Active live-game sessions should not show inactive roster members.
- Historical identity resolution requirement is satisfied in replay mode.

## Acceptance Criteria
- `live-game.html?teamId=...&gameId=...` excludes inactive players.
- `live-game.html?teamId=...&gameId=...&replay=true` includes inactive players.
- No regression to game loading or lineup/stat rendering.
