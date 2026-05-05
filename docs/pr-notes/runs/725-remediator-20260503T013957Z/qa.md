# QA Plan

The QA subagent timed out, so this inline plan is scoped to the security review feedback.

## Automated Checks

- Run affected unit tests for parent dashboard fee rendering.
- Run Firestore rules dry-run compilation.

## Manual/Security Checks

1. Linked parent can list assigned fee recipient records for their own child/team.
2. Parent from another team receives no fee recipient records.
3. Unauthenticated user receives no fee recipient records.
4. Team owner/admin can still create/read fee batches and recipients.
5. Collection group queries include team-scoped predicates so rules can authorize only legitimate teams.
