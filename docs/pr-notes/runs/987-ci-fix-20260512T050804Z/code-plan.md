# Code plan

1. Update `tests/smoke/admin-invite-redemption.spec.js` route matchers for `auth.js` and `team-access.js` to tolerate any `?v=<digits>` cache-bust value.
2. Do not change app runtime code or assertions.
3. Run the targeted smoke spec if local browser dependencies are present; otherwise document the Playwright browser dependency blocker.
