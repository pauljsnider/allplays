Current state: parent membership request authorization is split between Firestore rules and js/db.js transaction logic.

Change shape:
- Remove the requester-owned denied -> pending update branch from firestore.rules.
- Add a single pre-merge guard in the approval transaction that checks for an existing teamId/playerId link on the requester profile before writing user/player/request updates.

Controls comparison:
- New state reduces blast radius by removing a self-service resubmission path.
- Approval guard preserves existing transaction semantics while preventing duplicate logical linkage from being approved.

Rollback plan: revert the two code edits if parent request handling regresses.
