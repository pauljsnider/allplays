# Requirements role output

## Objective
Fix existing-user invite acceptance so invite links with `code` redeem after authentication.

## Current vs proposed
- Current: Existing-user link points to `login.html?code=...`; login path ignores code and redirects to dashboard.
- Proposed: After successful auth in login flow, if a valid invite code is present and user is in login redemption path, route to `accept-invite.html?code=...` so invite redemption logic runs.

## Constraints
- Keep signup activation flow unchanged for new users.
- Keep patch minimal and low-risk.
- Add automated unit coverage for redirect decision logic.

## Success criteria
- Existing user opening an invite link and logging in lands on invite redemption path.
- No regression for normal login (no invite code).
- Tests cover redirect behavior for invite and non-invite cases.
