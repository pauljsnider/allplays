# Issue 362 Architecture

## Decision
Use a shared `normalizeAdminEmailList` helper from `js/team-access.js` and call it from Edit Team load/save paths plus team-access checks.

## Why
- One normalization rule reduces drift between UI persistence and authorization checks.
- The change is small and contained to the admin email pathway.

## Controls
- Trim, lowercase, drop empties, and dedupe while preserving first-seen order.
- Keep access checks owner/platform-admin behavior unchanged.

## Blast Radius
- `edit-team.html`
- `js/team-access.js`
- tests that validate team access and Edit Team behavior
