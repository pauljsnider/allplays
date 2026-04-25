# Requirements

## Scope
Address review comment `3128207270` for PR #576: after team creation, force a full reload into edit mode so the new team is updated instead of duplicated.

## Acceptance Criteria
- Creating a team redirects to `edit-team.html?teamId=<id>` instead of fragment-only navigation.
- The edit page initializes from URL state, including Team ID panel setup.
- Saving after creation updates the same team instead of creating a duplicate.
- Regression coverage reflects the live edit-team DOM, including Team ID controls.

## User Impact
- Coaches land in the correct edit flow immediately after creating a team.
- Team setup continues on the same record, avoiding duplicate teams and missing Team ID UI.

## Role Note
- Requirements role spawn accepted (`a96ac08c-b642-4d9d-9ed2-dda9db129bae`) and completion was still pending at artifact creation time.
- Additional role spawns timed out at the local gateway, so this file preserves the enforced acceptance criteria for traceability.
