# Requirements Notes

## Acceptance Criteria
- Parent reads of `feeRecipients` require both a legitimate team link and a direct recipient/player match.
- Collection group reads cannot be broadened by querying arbitrary `teamId` values where a recipient field happens to match the current user.
- Team owners, team admins, and global admins keep existing read/write access for fee batches and recipients.
- Fee recipient create/update/delete remains scoped to the containing team and batch.

## Constraints
- Keep remediation limited to the review feedback.
- Preserve offline/manual team fee behavior. No payment-processing fields or flows are introduced.
- Prefer denormalized user links already used by the rules: `parentTeamIds` and `parentPlayerKeys`.
