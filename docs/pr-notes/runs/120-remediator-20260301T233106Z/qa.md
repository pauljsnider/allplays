# QA Role Notes

Test target:
- `tests/unit/auth-signup-parent-invite.test.js`

Checks:
- Parent invite profile failure rejects with original error.
- Auth user cleanup `delete()` is called exactly once for created user.
- `signOut(auth)` is called after cleanup attempt.
- Verification email is not sent on failed signup.
- Secondary test covers delete failure still rethrowing original profile error.

Execution plan:
- Run the focused Vitest file for parent invite signup failure handling.
