# Requirements Role Summary

- Objective: prevent destructive rollback in parent-invite signup once invite redemption side effects have been committed.
- Risk: deleting the auth account after invite redemption can strand a consumed invite and block self-service retry.
- Decision: once `redeemParentInviteFn` succeeds, never delete the auth account in this flow.
- UX/ops impact: preserve parent recoverability for transient profile write failures; allow support-free retry/remediation.
- Acceptance criteria:
  - If invite redemption fails, auth rollback is still allowed.
  - If profile write fails after successful redemption, auth rollback is skipped.
  - User-facing error remains `PARENT_INVITE_SIGNUP_ERROR`.
