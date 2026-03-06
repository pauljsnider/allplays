# Requirements Role Synthesis

## Objective
Ensure admin invite codes are one-time use: after first successful acceptance, every subsequent redemption attempt fails.

## User-facing expectation
- First redemption succeeds and grants admin access.
- Reuse attempt returns a clear already-used failure (`Code already used`).

## Risk and blast radius
- High severity: privileged onboarding route.
- Blast radius: unauthorized repeated admin enrollment attempts if invite code state is not consumed.

## Acceptance criteria
1. Admin invite redemption path always transitions code `used=false -> used=true` on success.
2. Reuse attempt fails in both URL and manual code paths (shared processor path).
3. Regression test covers consumption behavior and used-code rejection message.

## Assumptions
- `accept-invite` flow is mediated through `createInviteProcessor`.
- Existing atomic redemption path is intended to be source-of-truth when available.
