## Objective
Address PR #77 review concern about lost updates when appending `teams/{teamId}.adminEmails` during concurrent admin invite redemption.

## Current vs Proposed
- Current state in branch: `redeemAdminInviteAtomicPersistence` writes `adminEmails` with `arrayUnion(normalizedEmail)` inside `runTransaction`.
- Proposed state: keep this behavior and add explicit regression evidence so future edits do not reintroduce read-modify-write overwrite risk.

## Risk Surface / Blast Radius
- A regression here can silently drop newly added admins under concurrent invite acceptance.
- Blast radius is team access control (`adminEmails`) and onboarding trust.

## Acceptance Criteria
1. Persistence path continues using atomic append (`arrayUnion`) for `adminEmails`.
2. Team/admin-email update remains in a transaction with code consumption checks.
3. Validation evidence includes targeted test coverage for these constraints.

## Assumptions
- Firestore transaction retries remain enabled client-side.
- `arrayUnion` is the approved duplicate-safe append primitive for this collection field.
