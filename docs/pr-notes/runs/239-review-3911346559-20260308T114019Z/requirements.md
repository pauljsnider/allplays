Objective: preserve two-way shared schedule edits by storing mirrored fixture metadata that points back to the real counterpart team and game.

Current state:
- PR #239 adds mirrored linked fixtures for shared schedules.
- The mirrored payload stores `sharedScheduleOpponentTeamId` as `sourceGame.opponentTeamId`, which equals the mirrored document's owning team.
- Edit and delete paths in `js/db.js` rely on `sharedScheduleOpponentTeamId` plus `sharedScheduleOpponentGameId` to find the counterpart fixture.

Proposed state:
- On mirrored game documents, store `sharedScheduleOpponentTeamId` as the source team id.
- Keep source-side metadata unchanged so updates still know the mirrored team and game ids.

Acceptance:
1. Editing a mirrored shared game updates the original source game instead of creating a duplicate under the mirrored team.
2. Deleting a mirrored shared game deletes the original source game.
3. Unit coverage asserts the mirrored payload points to the source team as its counterpart.
