# Architecture Role Summary

## Decision
Keep logic in `processGoogleAuthResult` as the single enforcement point used by popup and redirect handlers.

## Design
- Add `clearPendingActivationCode()` helper for consistent session cleanup.
- Add `cleanupFailedGoogleSignup(user, context)` helper:
  - best-effort user deletion
  - independent best-effort sign-out
  - never masks original invite-link error
- Invoke helpers on:
  - missing activation code
  - invalid activation code
  - parent invite link failure

## Controls Equivalence
- Matches email/password flow fail-closed posture: cleanup + rethrow.
- Improves redirect flow parity by clearing pending code on failure.

## Rollback
Revert commit for `js/auth.js` and test file if unexpected onboarding regressions are observed.
