## Code Role

1. Remove stale admin-invite arguments in `js/signup-flow.js`.
2. Remove stale admin-invite arguments in `js/auth.js` and drop unused `addTeamAdminEmail` imports/plumbing.
3. Strengthen `tests/unit/signup-flow.test.js` and `tests/unit/auth-google-admin-invite-cleanup.test.js` to assert the obsolete fields are absent.
4. Run focused Vitest coverage for the impacted signup and Google admin-invite paths.
