# Architecture Notes

## Decisions

- Split `feeRecipients` create and update rules.
- Authorize creates against `request.resource.data.teamId`.
- Authorize updates against `resource.data.teamId` and require `request.resource.data.teamId == resource.data.teamId`.
- Parse `YYYY-MM-DD` due dates with `new Date(year, monthIndex, day)` so date-only strings remain local calendar dates.
- Preserve Timestamp/date-like parsing behavior for non-date-only values.
- Bump cache tokens for `db.js` and the touched parent fee module import.

## Risks And Rollback

- Existing records without `teamId` become non-updateable, which is safer than cross-team mutation.
- Rollback is limited to reverting this commit if legitimate fee updates fail unexpectedly.
