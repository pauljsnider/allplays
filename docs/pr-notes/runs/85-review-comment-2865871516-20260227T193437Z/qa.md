# QA Role Summary

## Regression targets
- Existing-user path with valid code still shows copyable code.
- Existing-user path with missing code now warns and does not render empty code block.
- New-user path with valid code still sends email.
- New-user path with missing code warns and skips email send.
- Email-send failure with valid code still falls back to shareable code.

## Evidence strategy
- Run unit tests for shared invite processing module (`tests/unit/edit-team-admin-invites.test.js`).
- Manually inspect updated inline flow for code gating before `sendInviteEmail` invocation.
