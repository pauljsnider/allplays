# Architecture Role (manual fallback)

## Current state
`executeEmailPasswordSignup` delegates admin invite persistence via `redeemAdminInviteAcceptance`, but does not directly ensure baseline user metadata write in that branch.

## Proposed state
Keep the existing atomic admin invite redemption flow, then execute a merge profile update for baseline identity metadata in `signup-flow`.

## Blast radius
Low and localized to email/password signup with `validation.type === 'admin_invite'` in `js/signup-flow.js`.

## Controls
- Preserve existing rollback and rethrow behavior on admin invite redemption errors.
- Keep generic access code consumption behavior unchanged for non-admin branches.
