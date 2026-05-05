# Code Plan

The code subagent timed out, so this inline implementation plan is scoped to the security review feedback.

## Files

- `firestore.rules`
- `js/db.js`
- `docs/pr-notes/runs/725-remediator-20260503T013957Z/*.md`

## Steps

1. Replace the parent fee recipient helper with a team-aware helper that requires `teamId`, parent team/player linkage, and direct recipient match.
2. Update collection group and nested `feeRecipients` read rules to use the team-aware helper.
3. Keep `feeBatches` parent documents admin-only.
4. Constrain nested admin writes to the path `teamId` and `batchId`.
5. Shape parent collection group queries by team ID so the tightened rules can authorize them without cross-team exposure.
