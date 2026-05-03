# Requirements Notes

## Acceptance Criteria

1. `feeRecipients` updates only succeed when the signed-in user is owner/admin of the existing `resource.data.teamId`.
2. `feeRecipients` updates cannot move a recipient record to another team by changing `teamId`.
3. Parents can still read only fee recipient records tied to their account or linked players.
4. Team owners/admins can still create, read, update, and delete fee recipient records for their own teams.
5. Date-only fee due dates like `2026-05-01` render as the same local calendar date in US time zones.
6. Firestore Timestamp and full datetime due dates continue to render correctly.
7. Fee sorting remains chronological after date-only parsing changes.
8. `parent-dashboard.html` bumps the `./js/db.js?v=...` token so browsers fetch the updated module.

## Non-Goals

- Redesign the fee data model.
- Change parent fee visibility rules beyond the reviewed security gap.
- Rework broader cache-busting strategy across the site.
