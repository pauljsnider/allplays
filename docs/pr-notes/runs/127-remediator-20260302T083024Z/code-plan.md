# Code Role Notes

- Implement minimal change in `js/signup-flow.js`:
  - Add `try/catch` around `redeemAdminInviteAcceptance` in `admin_invite` branch.
  - On catch, log context, call existing cleanup helper with `userCredential?.user`, then rethrow.
- Keep all other signup paths untouched.
