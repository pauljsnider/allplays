# Current-State Read
`redeemAdminInviteAcceptance` computes normalized email and then calls `updateTeam`, `updateUserProfile`, and `markAccessCodeAsUsed` sequentially. These are separate Firestore writes and can commit partially.

# Proposed Design
Add a single DB helper (`redeemAdminInviteAtomicPersistence`) in `js/db.js` that uses one Firestore `writeBatch` commit to update:
- `teams/{teamId}.adminEmails` via `arrayUnion(normalizedEmail)`
- `users/{userId}.coachOf` via `arrayUnion(teamId)`
- `users/{userId}.roles` via `arrayUnion('coach')`
- `users/{userId}.updatedAt` via `Timestamp.now()`
- `accessCodes/{codeId}` usage fields when `codeId` is present

Then inject this helper into `redeemAdminInviteAcceptance`; remove direct non-atomic write callbacks from `accept-invite.html`.

# Files And Modules Touched
- `js/db.js`
- `js/admin-invite-redemption.js`
- `accept-invite.html`
- `tests/unit/admin-invite-redemption.test.js`

# Data/State Impacts
- Same logical fields updated as before.
- Duplicate prevention delegated to Firestore `arrayUnion` instead of client list rebuilding.
- Reduced client-side read/write race exposure for duplicate array entries.

# Security/Permissions Impacts
- No expansion of permissions surface; writes still target the same documents.
- Atomic batch reduces inconsistency windows, improving role-based authorization correctness.

# Failure Modes And Mitigations
- Missing injected atomic callback: throw explicit error to avoid silent non-atomic fallback.
- Batch commit failure: no writes committed, preserving control equivalence.
- Missing user email or team: explicit precondition error before persistence.
