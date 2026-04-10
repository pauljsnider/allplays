# QA Role Notes

## Validation Focus
- User with only `coachOf` should not get full-management access through `hasFullTeamAccess`.
- Owner/team-admin-email/platform-admin should continue to pass full access.
- Parent logic in `getTeamAccessInfo` remains unchanged.
- No syntax/runtime issues in `js/team-access.js`.

## Suggested Checks
- Static syntax check on edited JS file.
- Manual scenario spot-check via pages that call `getTeamAccessInfo`.
