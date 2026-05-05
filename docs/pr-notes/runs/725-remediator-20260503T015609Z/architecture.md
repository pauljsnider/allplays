# Architecture Notes

## Architecture Decisions
- Centralize parent fee-recipient authorization in `isTeamFeeRecipientForCurrentParent(data, teamId)` so nested and collection-group rules use the same predicate.
- Require the fee recipient document `teamId` to match the rule context before evaluating recipient matches.
- Treat recipient matching and team linkage as separate controls: a matching `parentUserId`, `accountUserId`, `userId`, or `playerKey` is not enough unless the parent is linked to that team or player.
- Constrain collection-group writes to documents with a string `teamId`; constrain nested writes to the route `teamId` and `batchId`.

## Blast Radius
- Affects only Firestore authorization for `feeRecipients` under offline/manual fee batches and collection-group fee-recipient queries.
- Admin/coach paths remain owner/admin controlled.
