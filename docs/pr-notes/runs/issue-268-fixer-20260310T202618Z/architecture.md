# Architecture

Current state: `edit-config.html` decides access inline and only returns a boolean, which makes drift from shared access rules easy.

Proposed state: move the page-specific authorization decision into `js/edit-config-access.js`, built on top of `getTeamAccessInfo(...)`.

Controls:
- Shared full-access policy stays in `js/team-access.js`.
- `edit-config.html` consumes a page-specific decision object with `allowed` and `exitUrl`.
- The page continues to deny parent-only users and unresolved teams.

Rollback plan: revert the new helper and restore the prior inline access check in `edit-config.html`.
