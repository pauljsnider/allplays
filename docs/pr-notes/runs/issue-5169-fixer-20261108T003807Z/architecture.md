# Architecture review

## Boundary and root cause

`js/family-plan.js::removeFamilyMember(userId, memberId)` already invokes the authoritative `revokeHouseholdMemberAccess` callable with `{ membershipId: memberId }`. The React adapter selectively omitted that binding, leaving `parentHouseholdService` without a supported revocation path.

## Minimal design

1. Import and re-export `removeFamilyMember` in `legacyParentTools.ts`.
2. Add `revokeParentHouseholdMemberAccess(user, membershipId)` to `parentHouseholdService.ts`.
3. Require an authenticated user and normalize the ID with `compactString`.
4. Reject an empty normalized ID before delegation.
5. Delegate as `removeFamilyMember(user.uid, normalizedMembershipId)` without catch-and-rewrite.

## Risks

Direct callable use would duplicate and potentially drift from legacy semantics. Exact-argument tests guard against reversed identifiers, while rejection-propagation coverage prevents error masking.
