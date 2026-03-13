Implementation plan:
1. Patch `js/db.js` to gate private athlete profile returns on owner identity and skip missing season links.
2. Keep `js/athlete-profile-utils.js` and `firestore.rules` unchanged because the cited issues are already fixed in the current branch.
3. Run targeted athlete-profile unit tests.
4. Commit only the scoped remediation and note files.
