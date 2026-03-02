# Requirements Role Summary

## Objective
Ensure Google OAuth signup fails closed for parent invite redemption failures so users cannot proceed after invite-link rollback.

## Current vs Proposed
- Current: Google auth parent-invite path may leave ambiguous state around cleanup/session artifacts when invite linkage errors occur.
- Proposed: Parent invite linkage errors always propagate; cleanup runs (auth user delete + sign-out), and pending activation code is cleared for both popup and redirect flows.

## Risk Surface / Blast Radius
- Scope: `js/auth.js` Google new-user flows only.
- Blast radius: Auth onboarding for activation-code users; no impact to existing-user login path.

## Assumptions
- Parent invite linking failures are terminal and must block account creation completion.
- Redirect and popup flows must enforce identical fail-closed semantics.

## Recommendation
Adopt centralized failure cleanup and explicit error propagation with regression tests on popup + redirect parent-invite failure paths.

## Success Criteria
- Parent invite redeem failure rejects login/signup promise.
- Auth cleanup runs even when user deletion fails.
- Pending activation code is removed on failure and success paths.
