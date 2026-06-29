# Architecture Notes

## Current State
- PR #987 cache-busted page imports to newer versions, including `js/auth.js?v=38` and `js/team-access.js?v=3`.
- The admin invite smoke spec still mocked older exact versions, so Playwright allowed real modules to load instead of the intended stubs.
- `js/accept-invite-flow.js` also built the admin success message only from `redeemResult.teamName`, falling back to `the team` even when the fetched team had a name.

## Decision
- Keep the production flow and data model unchanged.
- Make the smoke mocks version-tolerant for auth and team-access ES module imports.
- Harden admin invite success text to use fetched `team.name` when the atomic redeem result does not include `teamName`.

## Impact
- No Firestore rules, data shape, or permission expansion.
- Existing post-redemption `hasFullTeamAccess` guard remains fail-closed.
- Blast radius is limited to smoke test routing and admin invite display fallback text.
