# Code Role (fallback synthesis)

## Note
Requested skill/subagent lane `allplays-code-expert` was not available in this runtime. This is a main-lane synthesis.

## Plan
1. Add failing test asserting `createInviteProcessor` calls `redeemAdminInviteAtomically(codeId, userId, authEmail)`.
2. Update `js/accept-invite-flow.js` to pass `authEmail` through.
3. Update `js/db.js` `redeemAdminInviteAtomically` to accept optional `fallbackEmail`, require a normalized email, and throw before any write if absent.
4. Run targeted unit tests for invite flow and admin invite persistence.
5. Stage and commit with issue reference.
