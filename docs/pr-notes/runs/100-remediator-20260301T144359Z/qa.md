# QA Role Notes

Thinking level: low.

## Coverage to verify
- Parent invite redemption failure:
  - Signup rejects.
  - Auth user delete called.
  - Signout called.
  - `updateUserProfile` not called.
- Parent invite profile write failure after successful redemption:
  - Signup resolves (does not hard fail).

## Test target
- `tests/unit/auth-signup-parent-invite.test.js`
