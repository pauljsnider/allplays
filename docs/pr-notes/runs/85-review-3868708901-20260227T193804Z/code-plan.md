# Code Role Output

## Patch Plan
1. Harden `processPendingAdminInvites` response parsing to avoid unsafe assumptions and enforce missing-code fallback.
2. Guarantee `pendingAdminInviteEmails` reset in `edit-team.html` using `try/finally` around invite processing.
3. Extend unit tests for malformed response + missing code behavior.

## Code Changes Applied
- Pending (applied in implementation section).

## Validation Run
- Pending (execute targeted unit test run after patch).

## Residual Risks
- End-to-end email delivery path still depends on external provider availability.

## Commit Message Draft
Fix invite processing guards and clear pending queue on all paths
