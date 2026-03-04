# Architecture Role (allplays-architecture-expert equivalent fallback)

Requested orchestration skill `allplays-orchestrator-playbook`, role skill `allplays-architecture-expert`, and `sessions_spawn` are unavailable in this runtime. This artifact captures equivalent architecture analysis.

## Current state
Rideshare rule gates rely on `isParentForTeam(teamId)`, which only checks `users.parentTeamIds`.

## Proposed state
Use parent access check that accepts either:
- team-level parent link (`parentTeamIds`), or
- player-level parent link (`parentPlayerKeys` with team prefix)

Apply this composite check to rideshare read/create/update/delete paths.

## Blast radius
- Limited to `teams/{teamId}/games/{gameId}/rideOffers/**` rules.
- No changes to tracker, roster, chat, or auth paths.

## Control equivalence
- Still requires signed-in users and existing ownership/driver constraints.
- Parent access remains bounded to linked team/player data.
