Objective: add coverage for the real parent invite redemption flow in `accept-invite.html` and prevent regressions that strand invited parents after login.

Current state:
- `js/accept-invite-flow.js` is unit-tested, but the page workflow is not.
- `accept-invite.html` contains the auth callback, success UI, manual code form, and redirect behavior that real users hit.
- Repeated auth callbacks can re-enter the page flow because the page has no local redemption guard.

Proposed state:
- Add page-level regression coverage for:
- authenticated parent invite redemption success
- manual logged-out code submission redirect to `login.html?code=...&type=parent`
- single redemption even if auth notifies the page more than once

Risk surface and blast radius:
- This flow controls parent access to team data, so failures block onboarding and team joining.
- Blast radius is limited to `accept-invite.html`, but the broken path is user-facing and high-value.

Assumptions:
- Parent invite redemption should happen once per page session for a given user and code.
- The existing Vitest harness with mocked DOM/module imports is the right level for this repo.

Recommendation:
- Add page-level tests around the real inline module and fix the page with the smallest possible state guard.
