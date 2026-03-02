# Requirements role synthesis (fallback single-agent)

Requested subagent skill `allplays-requirements-expert` was not available in local skills list, so this document captures equivalent requirements analysis.

## Objective
Ensure admin invites work during new-team creation so invited non-users can complete signup.

## Current behavior
- In `edit-team.html`, clicking **Send Invite** with no `currentTeamId` only appends email to `adminEmails`.
- No `admin_invite` access code is generated and no email/link is sent.

## Required behavior
- In create-team flow (`currentTeamId` absent), invited admin emails must result in actual invite codes after team is created.
- Invite delivery should be attempted for each invited email after save; if email send fails, UI should still surface copyable code/link fallback.
- Existing-team flow must remain unchanged.

## Success criteria
- New-team save triggers invite generation and email attempt for every pending admin invite email.
- Access code validation path remains compatible (`admin_invite` with `teamId`).
- No silent success state where email is listed without a corresponding invite code generation path.
