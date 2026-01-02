# Bug: Parent Player Update Rule Too Permissive

## Summary
Parents can update **any** player on a team, not just their own child, because the Firestore rules check only `teamId` in `parentTeamIds` and ignore `playerId`.

## Impact
- Any parent linked to a team can update another player's `photoUrl`, `emergencyContact`, or `medicalInfo`.
- This is a privacy/security regression and violates least-privilege for parent access.

## Where
- `firestore.rules:31-37` (`isParentForPlayer`) ignores `playerId`.
- `firestore.rules:94-98` uses `isParentForPlayer` to authorize parent updates.

## Current Behavior
- If a parent is linked to **any** player on a team, they can update **all** player docs for that team.

## Expected Behavior
- Parents should only be able to update fields for **their linked player(s)**.

## Suggested Fix
1. Update `isParentForPlayer` to check `parentOf` entries for both `teamId` and `playerId`:
   ```
   function isParentForPlayer(teamId, playerId) {
     let userPath = /databases/$(database)/documents/users/$(request.auth.uid);
     return isSignedIn() &&
            exists(userPath) &&
            get(userPath).data.get('parentOf', [])
              .where(p, p.teamId == teamId && p.playerId == playerId)
              .size() > 0;
   }
   ```
2. Keep `parentTeamIds` only for **team-level** chat access (or add a dedicated `isParentForTeam` function for that).
3. Consider a migration/backfill to ensure all existing parents have correct `parentOf` entries.

## Validation Steps
- Link two parents to two different players on the same team.
- As Parent A, attempt to update Parent B's player `medicalInfo`.
- Should be denied by rules after the fix.

## Notes
- There is also a potential mismatch between UI access checks (uses `parentOf`) and chat rules (uses `parentTeamIds`). Parents without `parentTeamIds` will see UI but get rule denials.
