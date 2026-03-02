# Code Role Summary

- Minimal patch:
  - `js/parent-invite-signup.js`: gate auth rollback solely on `!inviteRedeemed`.
  - keep invite rollback attempt best-effort for consistency, but decouple from auth deletion.
  - `tests/unit/parent-invite-signup.test.js`: update profile-failure test to assert no auth rollback after successful redeem.
  - `js/auth.js`: bump cache-busting query for updated module import.
- Safety:
  - preserves user-facing error contract.
  - reduces unrecoverable partial-transaction outcomes.
