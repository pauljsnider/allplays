# QA

## Coverage Targets
- Browser-level coverage for the existing-team admin invite path from `edit-team.html` to `accept-invite.html`.
- Page-level admin coverage inside `accept-invite.html`.
- Redirect coverage proving login preserves `type=admin` and `type=parent` when invite redemption is requested.

## Test Matrix
1. Existing-team owner/admin invites an existing user, Team Management exposes a shareable admin code/link, and the invited user redeems it into `dashboard.html`.
2. Signed-out admin manual code flow preserves `type=admin` through login and back into redemption.
3. Cross-device email-link admin completion shows the email-required state, completes sign-in, redeems the admin invite, and lands on `dashboard.html`.
4. Parent invite redirect behavior still preserves `type=parent`.

## Assertions
- Email is normalized before invite creation and persistence.
- Shareable admin code/link UI appears for existing-user and fallback-code outcomes.
- `redeemAdminInviteAtomically(...)` is called exactly once with `codeId`, `userId`, and auth email.
- Success copy includes the team name.
- Final redirect lands on `dashboard.html`.

## Residual Risk
- Full Playwright execution currently depends on host browser libraries that are missing in this environment, so browser specs were added and reviewed but not executed end-to-end here.
