# Code Plan

## Implementation Plan
- Update `isTeamFeeRecipientForCurrentParent` to accept the expected team id and require `resource.data.teamId == teamId`.
- Add explicit `hasTeamLink` and `hasRecipientMatch` checks so both must be true for parent reads.
- Update nested `teams/{teamId}/feeBatches/{batchId}/feeRecipients` and collection-group `feeRecipients` rules to call the stricter helper.
- Keep client collection-group fee queries team-scoped to the current parent's known child teams to align with least privilege and reduce denied reads.

## Rollback
- Revert the remediation commit if parent fee visibility unexpectedly regresses, then add dedicated rules tests before reapplying.
