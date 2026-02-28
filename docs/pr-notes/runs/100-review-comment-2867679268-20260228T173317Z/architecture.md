# Architecture Role Notes

## Current state
A shared `try/catch` in parent-invite paths wraps both `redeemParentInvite` and `updateUserProfile`; any exception triggers cleanup and rethrow.

## Proposed state
Split responsibilities:
- `redeemParentInvite` guarded by fail-closed `try/catch` with cleanup+rethrow.
- `updateUserProfile` executed in a separate best-effort `try/catch` that logs but does not throw.

## Risk and blast radius
- Reduced blast radius: transient Firestore profile-write errors no longer invalidate successful invite linkage.
- Preserved control boundary: failed linkage still deletes the newly created auth user and signs out.
- Scope limited to parent-invite branches in `signup` and Google auth new-user setup.

## Control equivalence
- Access linking control is unchanged and still mandatory.
- Cleanup behavior remains unchanged for true linking failure.
- No change to non-parent activation paths.
