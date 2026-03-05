# Requirements role (fallback inline)

## Objective
Resolve three unresolved PR #183 review threads with minimal, targeted code changes.

## Required outcomes
- `js/db.js` publish path keeps `publishedAt` type consistent between stored bracket fields and `publishedView` model.
- `js/bracket-management.js` BYE auto-advance must not complete games whose empty slot depends on unresolved upstream game winners.
- `js/db.js` bracket reads for `onlyPublished` must query Firestore with `where('status','==','published')` to satisfy public rules.

## Constraints
- Keep blast radius limited to bracket publish/read helpers and BYE resolution logic.
- Preserve existing bracket flow and statuses for valid auto-advance cases.
- Validate with focused unit tests for bracket behavior and policy checks.
