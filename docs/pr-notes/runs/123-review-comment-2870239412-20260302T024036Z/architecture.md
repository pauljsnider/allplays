# Architecture Role Summary

## Decision
Use Firestore rules as the canonical write authorization model and align client-side helper logic to it.

## Control Equivalence
- Canonical backend control: `isTeamOwnerOrAdmin(teamId)` in `firestore.rules`.
- Client helper should not authorize broader privilege than backend write checks.
- Remove `coachOf` from `hasFullTeamAccess` to preserve equivalent or stricter client gating.

## Tradeoffs
- Tradeoff: delegated coaches may lose direct access to management screens unless they are in `adminEmails`.
- Benefit: eliminates predictable write failures and authorization drift.

## Rollback
- Revert the helper/test commit if product decision changes and backend rules are expanded to include coach delegation.
