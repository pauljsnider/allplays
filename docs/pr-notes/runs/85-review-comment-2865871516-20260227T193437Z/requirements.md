# Requirements Role Summary

## Objective
Prevent sending admin invite emails with null/undefined/empty invite codes.

## User-visible expectations
- Existing-user invites only show a shareable code when a non-empty code exists.
- New-user invites only call `sendInviteEmail` when a non-empty invite code exists.
- When code generation fails, UI surfaces explicit manual retry guidance instead of attempting email.

## Acceptance criteria
- No `sendInviteEmail(email, code, 'admin', ...)` call occurs with falsy/empty `code`.
- Missing-code path is handled as warning state with actionable message.
- Existing behavior for successful code generation and email fallback remains intact.
