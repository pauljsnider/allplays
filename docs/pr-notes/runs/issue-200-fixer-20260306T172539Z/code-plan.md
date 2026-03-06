Implementation plan:
1. Add a unit test that fails while auth/signup module versions remain stale.
2. Bump `auth.js` import versions for `signup-flow.js` and `admin-invite.js`.
3. Bump every entry point importing `auth.js` so browsers fetch the updated auth module.
4. Run the focused Vitest suite around signup and invite redemption.
5. Commit the targeted fix and tests with an issue-linked message.
