# Code Plan

## Patch
- Update admin invite smoke mocks to match `auth.js` and `team-access.js` with optional numeric cache-bust query strings.
- Update admin invite success text to fall back to fetched `team.name` when `redeemAdminInviteAtomically` does not return `teamName`.

## Files
- `tests/smoke/admin-invite-redemption.spec.js`
- `js/accept-invite-flow.js`

## Validation
- Run the focused Playwright smoke spec for admin invite redemption.
- Run targeted invite-related unit tests if the repo has the needed test dependencies installed.

## Commit Message
- `fix:address-ci-failure: update admin invite smoke mocks`
