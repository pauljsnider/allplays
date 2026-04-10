Objective: prove the parent invite flow works from the page entry point and stays idempotent under auth churn.

Coverage plan:
- Boot `accept-invite.html?code=AB12CD34` with an authenticated parent and verify:
- `validateAccessCode`, `redeemParentInvite`, and `getTeam` are used
- success copy includes player and team context
- redirect lands on `parent-dashboard.html`
- duplicate auth callbacks do not redeem twice
- Boot the page logged out, submit `ab12cd34`, and verify redirect to `login.html?code=AB12CD34&type=parent`.
- Reboot the page as authenticated after that redirect and verify invite redemption still occurs exactly once.

Regression guardrails:
- Assert on user-visible state and redirect target, not just helper calls.
- Fail the test if the same invite is redeemed twice in one page session.

Validation:
- Run focused Vitest for the new page test file, then rerun the touched invite-flow unit test alongside it.
