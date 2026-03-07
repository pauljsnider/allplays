QA focus:
- Reproduce on a cached client by loading `login.html?code=...&type=admin` before and after deploy.
- Confirm signup creates the account, shows the verification flow, and lands the user on a dashboard that contains the invited team.
- Confirm the access code is marked used exactly once.

Regression guardrails:
- Parent invite signup still passes existing unit tests.
- Existing accept-invite admin flow remains unchanged.
- Static regression test now ensures cache-busting versions are updated when signup-path modules change.

Validation commands:
- `./node_modules/.bin/vitest run tests/unit/admin-invite-signup-cache-busting.test.js tests/unit/signup-flow.test.js tests/unit/admin-invite.test.js tests/unit/admin-invite-redemption.test.js tests/unit/accept-invite-flow.test.js`

Residual risk:
- This patch fixes stale-client delivery; it does not repair already-consumed broken invites in data.
