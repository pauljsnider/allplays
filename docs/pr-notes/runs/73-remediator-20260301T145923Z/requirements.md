# Requirements role notes
- Objective: Resolve three PR #73 review threads focused on parent-invite signup rollback and activation-code cleanup.
- Required behavior:
  - Parent invite redemption must not leave the system unrecoverable if later profile updates fail.
  - Auth rollback should not run after invite redemption has consumed state unless invite redemption is also rolled back.
  - Google redirect flows must clear `pendingActivationCode` even when signup processing fails.
- Scope: Only `js/parent-invite-signup.js` and `js/auth.js`; minimal targeted changes.
