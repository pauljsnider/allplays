# Requirements Role Output

## Problem Statement
Parent invite signups can create Firebase Auth accounts without successful parent linkage, producing unusable orphaned accounts and inconsistent security behavior between email/password and Google auth.

## User Segments Impacted
- Parents joining a team via invite code.
- Coaches/managers expecting parent rosters to reflect successful invite redemption only.
- Admins/support handling account recovery and cleanup.

## Acceptance Criteria
1. If `redeemParentInvite` fails during email/password signup, signup fails and returns an error to the caller.
2. If `redeemParentInvite` fails during email/password signup, the newly created Firebase Auth user is deleted before the error is surfaced.
3. If `redeemParentInvite` fails during Google new-user signup, the Google-created user is deleted and the auth session is signed out before surfacing the error.
4. `updateUserProfile` is not called when parent invite redemption fails in either signup path.
5. Standard non-parent activation code signup behavior remains unchanged.

## Non-Goals
- Refactoring auth flow structure beyond parent invite failure handling.
- Changing activation code validation semantics.
- Adding UI copy or UX redesign in login/signup screens.

## Edge Cases
- User deletion fails after invite-linking failure; system must still sign out and propagate original failure context.
- Null `auth.currentUser` during cleanup path in email/password flow.
- Google redirect/popup differences should still share identical failure behavior through `processGoogleAuthResult`.

## Open Questions
- Should parent-invite failure reasons be user-friendly mapped in UI, or remain raw errors from backend logic?
