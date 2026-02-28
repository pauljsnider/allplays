# Code Role Summary

## Minimal Patch
1. In `js/admin-invite.js`, move `addTeamAdminEmail(teamId, userEmail)` to execute after `updateUserProfile(userId, { coachOf, roles })`.
2. In `tests/unit/admin-invite.test.js`, assert invocation order to lock in authorization-safe sequencing.

## Files Changed
- `js/admin-invite.js`
- `tests/unit/admin-invite.test.js`
- `docs/pr-notes/runs/68-review-3860968123-20260226T133232Z/*`

## Reasoning
This addresses the concrete review defect with the smallest reliable client-side change and no rules expansion.
