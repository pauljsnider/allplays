# Requirements Role Notes

Objective: Resolve PR #120 review threads about orphaned Firebase Auth users when parent-invite signup fails.

Required behavior:
- If `createUserWithEmailAndPassword` succeeds but parent invite finalization fails (`redeemParentInvite` or `updateUserProfile`), `signup()` must clean up the created Auth user.
- Cleanup must include best-effort sign-out and rethrow original error.
- Unit tests must explicitly verify delete cleanup invocation on failure.

Acceptance evidence:
- `js/auth.js` performs user deletion before rethrow on parent-invite failure.
- `tests/unit/auth-signup-parent-invite.test.js` asserts created user's `delete()` is called and signup rejects with original error.
