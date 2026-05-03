# Architecture

## Decision

Keep offline team fees stored under `/teams/{teamId}/feeBatches/{batchId}/feeRecipients/{recipientId}`, but make parent read authorization both path/team aware and recipient aware.

## Control Shape

- Direct nested rule: parent read requires `resource.data.teamId == teamId`, a legitimate parent/team or parent/player link, and recipient match to the current parent account or linked player.
- Collection group rule: parent read requires a valid `teamId` field and the same team-aware recipient check.
- Admin access remains through `isTeamOwnerOrAdmin(teamId)`.
- Writes remain admin-only, with nested writes constrained to the path `teamId` and `batchId`.

## Blast Radius

The change reduces cross-team exposure risk for `feeRecipients` collection group reads. Documents missing required team metadata fail closed for parents while remaining repairable by admins.

## Rollback

Revert the `firestore.rules` and query-shaping change, then redeploy rules. No data rollback is required.
