# Code role output

## Plan
1. Add `js/invite-redirect.js` pure helper with invite-code normalization and redirect selection.
2. Add `tests/unit/invite-redirect.test.js` with expected failing case for invite redemption redirect.
3. Wire `login.html` auth-success branches to use helper when processing login with invite code.
4. Run targeted test then full `tests/unit`.
5. Commit with issue reference.

## Conflict resolution synthesis
- Requirements and architecture align on routing to `accept-invite` rather than duplicating redemption logic in login.
- QA requests unit coverage; we satisfy with pure helper tests to avoid brittle DOM tests.
