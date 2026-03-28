# Code plan

1. Inspect `js/db.js` approval transaction and identify the exact user-profile write.
2. Remove or relocate the unauthorized `/users/{requesterUserId}` write while preserving team membership updates.
3. Run focused validation for affected tests and review diff for scope control.
