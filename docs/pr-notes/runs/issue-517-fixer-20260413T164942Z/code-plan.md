# Code Plan

## Acceptance Criteria
- Team Management admin fallback UI exposes a usable admin code/link.
- Admin redemption keeps `type=admin` across login redirect boundaries.
- `accept-invite.html` covers authenticated admin redemption, signed-out login handoff, and cross-device email-link completion.
- Parent redirect behavior remains intact.

## Implementation Plan
1. Add a browser-level smoke spec for the Team Management existing-user admin invite handoff into `accept-invite.html`.
2. Extend `tests/unit/accept-invite-page.test.js` with admin page scenarios.
3. Update `js/invite-redirect.js` and `js/login-page.js` so invite redemption preserves the invite type.
4. Update `js/edit-team-admin-invites.js` so generated admin follow-up links include `type=admin`.
5. Adjust related unit and smoke tests to assert the typed invite URLs.

## Risks And Rollback
- Risk: invite URLs regress by dropping `type=admin`.
- Risk: browser tests cannot run on hosts missing Playwright system dependencies.
- Rollback: revert the invite URL/login redirect changes plus the new tests.
