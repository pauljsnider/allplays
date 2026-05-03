# Architecture note

## Acceptance Criteria
- `js/db.js` changes are paired with a browser import cache-bust update.
- Scope stays limited to the import reference needed by the parent dashboard change.

## Architecture Decisions
- Keep the static-site cache-busting pattern already used in this repo: query param version on direct ES module imports.
- Since PR #703 changes `js/db.js` for parent fee recipient loading and wires it from `parent-dashboard.html`, bump the `parent-dashboard.html` `./js/db.js` import from `v=26` to `v=27`.

## Risks And Rollback
- Risk is low: query param only changes browser cache identity, not runtime logic.
- Rollback is reverting the import version bump if the `js/db.js` change is reverted.
