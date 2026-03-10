Chosen fix:
1. Add `tests/unit/auth-google-admin-invite-cleanup.test.js`.
2. Update `js/auth.js` admin-invite branch inside `processGoogleAuthResult`:
   - fail closed on invite redemption errors
   - keep profile write best-effort after successful redemption
3. Run focused Vitest coverage for the new file and adjacent admin invite suites.

Assumptions:
- Email/password admin invite signup is already fail-closed and should remain unchanged.
- `cleanupFailedNewUser` is the right rollback primitive for Google new-user onboarding.
