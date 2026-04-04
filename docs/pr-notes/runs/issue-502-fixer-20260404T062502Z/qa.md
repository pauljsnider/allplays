Coverage target:
- Existing user email/password login from `/login.html?code=ab12cd34&type=parent`.
- Existing user Google redirect login from `/login.html?code=ab12cd34&type=admin` with `postGoogleAuthMode=login`.

Assertions:
- Final URL is `accept-invite.html?code=AB12CD34`.
- Redirect does not fall back to `dashboard.html` or `parent-dashboard.html`.

Validation plan:
- Run the new smoke spec in isolation.
- Run the focused unit tests for redirect helpers if app code changes.

Residual risk:
- This suite uses module mocks for auth/db, so it verifies page wiring rather than live Firebase behavior.
