# Architecture Role (fallback synthesis)

## Note
Requested skill/subagent lane `allplays-architecture-expert` was not available in this runtime. This is a main-lane synthesis.

## Current state
- `accept-invite-flow.js` prefers `redeemAdminInviteAtomically(validation.codeId, userId)`.
- `js/db.js:redeemAdminInviteAtomically` resolves email from user profile or `auth.currentUser.email`.
- If email resolution fails, function still marks code used and updates user profile but can skip team `adminEmails` write.

## Proposed state
- Pass `authEmail` from invite flow into atomic redemption.
- In atomic redemption, resolve email from user profile, auth context, or provided invite-flow authEmail.
- Fail closed if normalized email is unavailable before marking code used.

## Why minimal
- Two-file targeted change, no API surface change beyond optional arg.
- Aligns with existing access model that requires `team.adminEmails` for full team-management access.
