# Code Role Notes

## Patch plan
1. Update `js/parent-invite-signup.js` to gate auth rollback on invite rollback success.
2. Update `js/auth.js` to clear `pendingActivationCode` in a `finally` block for new-user Google flow.
3. Add regression test for invite-rollback-failure branch.

## Conflict resolution
- Requirements and QA both require fail-closed semantics.
- Architecture highlights that deleting auth user after failed invite rollback recreates lockout.
- Final decision: prioritize recoverability by retaining auth user when invite rollback fails, while still throwing user-facing signup error.
