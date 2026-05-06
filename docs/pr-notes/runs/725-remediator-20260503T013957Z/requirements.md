# Requirements

## Acceptance Criteria

1. Parent users can read only fee recipient records where they are legitimately linked to the same team and the record directly matches their account or linked player.
2. Parent users cannot read fee recipient records for unrelated teams, including collection group query paths.
3. Collection group reads must fail closed when `teamId` is missing or malformed.
4. Team owners, team admins, and global admins retain admin access to team fee batches and recipients.
5. Parent access remains limited to `feeRecipients`; `feeBatches` parent docs stay admin-only.

## Risks

- Collection group queries are the highest-risk path because normal team path scoping is bypassed.
- Recipient identity match alone is insufficient; rules must require team linkage as well.
- Missing `teamId` should deny parent access rather than infer from path for collection group reads.
