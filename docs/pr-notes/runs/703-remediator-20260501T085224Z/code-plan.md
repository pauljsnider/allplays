# Code Plan

## Patch Plan

- `firestore.rules`: split create/update and tie update authorization to existing `resource.data.teamId`.
- `js/parent-dashboard-fees.js`: parse date-only strings as local dates before falling back to `new Date(value)`.
- `parent-dashboard.html`: bump `db.js` and parent fee module cache-busting tokens.

## Commit Message Draft

Fix parent fee update rules and due date parsing
