Validation focus:
- Re-request rule must still permit legitimate parents to update a declined or waitlisted request back to pending.
- Re-request rule must now require active `isParentForPlayer(teamId, resource.data.childId)` access.
- No regression to the existing field-diff restriction or open-offer guard.

Checks:
1. Update the focused unit test that inspects `firestore.rules` so it asserts the new parent-child access predicate.
2. Run `npx vitest run tests/unit/rideshare-rerequest-policy.test.js`.

Residual gap:
- This repo does not include an emulator-backed Firestore rules test for revoked membership. Validation here is string-level regression coverage plus manual rule inspection.
