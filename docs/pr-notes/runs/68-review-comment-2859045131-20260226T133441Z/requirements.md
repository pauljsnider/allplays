# Requirements Role Summary

## Objective
Ensure admin invite redemption reliably succeeds under Firestore rules that restrict team updates to owner/admin/coach/global admin.

## Current State
`redeemAdminInviteAcceptance` updates user profile first, then team `adminEmails`.

## Risk Surface
If the profile write does not persist `coachOf` before team update, team write is denied, leaving invite redemption partial.

## Acceptance Criteria
- Team admin email write only executes after confirmed membership (`coachOf` contains `teamId`).
- Failure is explicit when membership did not persist.
- Existing successful path remains intact for signup, Google signup, and accept-invite page.
