# QA Plan

## Checks
- Static inspection: `calendarTokenHasTeamAccess` no longer grants access from `tokenData.roles`, `tokenData.member`, or `tokenData.teamIds`.
- Regression: verify current owner, admin email, and parent-team profile links remain accepted.
- Negative scenario: a token document with stale member/admin fields but no current owner/admin/parent link is denied.

## Repo Test Command
No automated test script is defined for this static/Firebase-functions repo. Run syntax validation for `functions/index.js` with Node.
