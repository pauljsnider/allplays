Current state:
- `accept-invite.html` uses the shared atomic admin redemption path.
- `js/auth.js` Google new-user onboarding handles `admin_invite` inline and catches errors without rollback or rethrow.

Observed gap:
- If `redeemAdminInviteAcceptance(...)` fails for a Google signup or redirect flow, the catch block logs the error and execution continues.
- That can produce a successful auth result without guaranteed `team.adminEmails` persistence, which matches the false-success symptom in issue #198.

Proposed change:
1. In `processGoogleAuthResult`, isolate admin invite redemption in its own `try` block.
2. On redemption failure, clear the pending activation code, delete/sign out the just-created auth user, and rethrow.
3. Keep the profile write in a separate best-effort `try` block so a post-redeem Firestore profile failure does not roll back a successful access grant.

Why this path:
- Minimal patch with clear control equivalence.
- Reuses the existing rollback helper and mirrors the parent invite fail-closed contract.
