# Architecture

## Current State
The save flow derives `counterpartTeamId` from `selectedOpponentTeam` and then falls back to cached linkage from `gamesCache[editingGameId]`. That allows stale cross-team routing after the form has intentionally cleared the link.

## Proposed State
Derive `counterpartTeamId` only from the submitted `gameData.opponentTeamId`. The notification target should reflect the post-edit persisted linkage, not the pre-edit cache.

## Blast Radius
Single code path in `edit-schedule.html` for game save notifications. No Firestore schema, rules, or shared sync behavior changes.

## Risks
Low. The main risk is under-notifying if submitted linkage is unexpectedly missing, which is safer than leaking notifications to the wrong team.

## Rollback
Revert the single counterpart-target resolution change and the related unit assertion if unexpected notification regressions appear.
