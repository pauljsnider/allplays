# Code Role Summary

## Patch
- Update `processInvite` signature to accept `authEmail` fallback.
- Resolve admin invite email as `profile?.email || authEmail`.
- Pass auth email from all invite-processing call sites:
  - email-link auto flow
  - existing logged-in flow
  - email form fallback flow
  - manual code submission flow

## Non-goals
- No modifications to `js/admin-invite.js` logic.
- No schema/rules/UI updates.
