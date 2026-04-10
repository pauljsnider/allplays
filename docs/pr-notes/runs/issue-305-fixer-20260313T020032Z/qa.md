Test focus:
- Email/password signup admin invite path delegates to atomic persistence.
- Normalized email is used for the admin grant.
- Cache-bust references update when `auth.js` import wiring changes.

Regression guardrails:
- Parent invite signup tests must still pass unchanged.
- Existing admin invite redemption tests for `accept-invite.html` should remain green.

Manual spot-check recommendation:
1. Generate an admin invite from `edit-team.html`.
2. Open `login.html?code=...&type=admin` while logged out.
3. Complete signup and verify the invited team appears on the dashboard with team-management access.
