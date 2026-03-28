# Requirements role output

## Objective
- Preserve invite redemption for existing users who intentionally log in from an invite link, including the Google redirect-return path.

## Current state
- `login.html` redeems invite links for authenticated users on invite URLs.
- Google redirect-return adds a login-vs-signup gate via `sessionStorage.postGoogleAuthMode`.
- The generic auth-state auto-redirect path does not honor that gate.

## Proposed state
- Existing-user Google redirect returns from invite links redeem the invite only when the stored mode is `login`.
- Stored `signup` mode follows the normal role redirect, even if auth-state redirect fires after the Google redirect handler.

## Risk surface
- User-facing login routing on `login.html`.
- Invite redemption pages for `type=parent` and `type=admin`.
- Race behavior between Google redirect handling and `checkAuth`.

## Assumptions
- Already-authenticated users who directly open an invite link should still be redirected to invite redemption.
- The repo’s live automated test surface is Vitest, not Playwright.
- A small extraction for testability is acceptable if behavior remains unchanged outside the targeted fix.

## Recommendation
- Add focused automated coverage around the page redirect coordinator and fix the auth-state race by persisting the invite-redemption decision for the current page load.
