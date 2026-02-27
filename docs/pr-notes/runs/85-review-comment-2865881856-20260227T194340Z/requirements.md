# Requirements Role Summary

## Objective
Ensure new-team admin invite processing surfaces redemption info for already-registered users so coach access completion is not blocked.

## UX/Behavior Requirements
- After team creation and pending admin invite processing, surface copyable redemption details for any `existing_user` result with a code.
- Also surface code-based fallback outcomes when invite email failed but code exists.
- Keep unresolved invite outcomes visible via explicit manual follow-up notice.
- Preserve existing success path for normal email-sent invites.

## Acceptance Criteria
- Existing-user invites with code are displayed before redirect, with direct `accept-invite.html?code=...` links.
- Invite outcomes with missing code or failed processing are counted and surfaced as manual follow-up.
- New-team creation still redirects to dashboard after follow-up prompt/alert handling.
