# QA Notes

## QA Plan
- Inspect `firestore.rules` to confirm parent fee recipient reads require: signed-in user, document `teamId`, matching route/query team, team/player link, and recipient match.
- Confirm collection-group reads cannot succeed without a string `teamId` and the same helper predicate.
- Confirm team owner/admin/global admin access still bypasses parent-only checks through `isTeamOwnerOrAdmin`.
- Run the unit test suite because there is no dedicated Firestore rules test runner in this repo.

## Manual Security Cases
- Parent linked to Team A and assigned a Team A fee recipient: allow.
- Parent linked to Team A but querying Team B recipient with matching `userId`: deny.
- Parent not linked to Team A but with matching recipient field: deny.
- Team admin for Team A: allow read/write for Team A fee recipients.
