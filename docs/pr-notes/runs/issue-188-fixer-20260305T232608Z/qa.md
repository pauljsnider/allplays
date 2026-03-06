# QA Role (fallback synthesis)

## Note
Requested skill/subagent lane `allplays-qa-expert` was not available in this runtime. This is a main-lane synthesis.

## Regression test strategy
- Add unit test in `tests/unit/accept-invite-flow.test.js` proving `authEmail` is passed to atomic redemption path.
- Existing flow-level tests already cover fallback non-atomic path updating `team.adminEmails`.

## Manual checks
- Invite existing user as admin.
- Accept invite and confirm dashboard team visibility.
- Confirm edit-team and edit-roster access.

## Risk checks
- Ensure no behavior change to parent invite path.
- Ensure no behavior change to redirect destinations.
