# Code Plan

1. Harden `isFamilyMembershipRemoval` in `firestore.rules` with `data.accessStatus == 'revoked'`.
2. Remove the unprivileged `revokeHouseholdAccess` implementation and helpers from `js/family-plan.js`.
3. Change `removeFamilyMember` to call `revokeAccessCode` before updating the family membership shell record.
4. Update family plan unit tests to match the safe client-side behavior.
