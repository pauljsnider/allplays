Validation plan:
- Run the affected Playwright spec file only.
- Confirm both tests still pass.

Evidence to collect:
- Passing output for `tests/smoke/login-invite-redirect.spec.js`.

Residual risk:
- This validates only the targeted smoke spec because the repo does not define a broader automated test suite in repo guidance.
