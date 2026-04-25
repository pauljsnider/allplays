# Code Plan

## Root Cause
`tournament-standings.js` treated stored scores as venue-relative even when the surrounding app stores them team-relative.

## Minimal Patch Plan
- Compute `teamScore` and `opponentScore` from the raw game object.
- For away games, swap score placement along with team names.
- Update the existing aggregation test to use team-relative away data.
- Add a focused unit test proving an away win remains a win in pool standings.

## Rollback
Revert the `buildPoolGame` score remap and the new unit assertions if downstream behavior contradicts the team-relative score contract.
