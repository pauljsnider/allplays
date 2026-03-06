Validation target:
- `tests/unit/accept-invite-flow.test.js`

Checks:
- Existing success path still returns dashboard redirect and team name.
- Existing rejection path still bubbles transactional errors.
- New regression proves malformed atomic results throw instead of returning a false success state.
