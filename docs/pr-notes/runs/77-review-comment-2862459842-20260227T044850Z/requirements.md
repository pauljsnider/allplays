## Problem Statement
First-time admin invite redemption can fail with `permission-denied` because team admin email writes require owner/admin privileges before the invited user has `coachOf` access.

## User Segments Impacted
- Coach/admin accepting a first admin invite from `accept-invite.html`.
- Existing team owners who invite new admins and expect zero-friction onboarding.
- Parents indirectly impacted when coach onboarding stalls and no admin can manage team workflows.
- Program operators impacted by support load from failed invite acceptances.

## Acceptance Criteria
1. For a valid unused `admin_invite`, persistence writes user `coachOf` membership before any team document update that requires team admin/owner privileges.
2. A newly invited admin can complete redemption without `permission-denied` on `/teams/{teamId}` update.
3. Redemption continues to enforce code validity checks (`type`, `teamId`, `used` state) before finalizing invite usage.
4. Existing success path still adds normalized email to `teams/{teamId}.adminEmails`, adds `teamId` to `users/{uid}.coachOf`, and marks access code used.
5. Failure path does not mark access code used when preconditions fail.

## Non-Goals
- Rewriting Firestore rules model.
- Replacing client-side redemption with Cloud Functions in this PR.
- Broad auth/role model refactors outside admin invite redemption.

## Edge Cases
- Re-redeem attempt with already-used code must fail.
- Missing team or mismatched `teamId` in code must fail.
- Missing/blank user email must fail before any team write.
- User already in `coachOf` should remain idempotent.

## Open Questions
- Whether a server-side privileged path (Callable Function) should eventually replace this client-mediated multi-write flow for stricter atomic guarantees.
