# Architecture

## Decisions
- Add `selectedHelpRole` as transient local React state in `AppSearchDialog`.
- Keep role type local to the component: `all`, `parent`, `coach`, `admin`, `member`.
- Render Help role chips as a Help section header accessory.
- Do not pass selected role into `computeAppSearchResults`, `searchHelpKnowledge`, or Firebase queries.
- Reset selected role to `all` whenever the dialog opens, matching existing query reset behavior.

## Files
- `apps/app/src/components/AppSearchDialog.tsx`
- `tests/unit/app-search-integration.test.jsx`

## Constraints
- No backend search integration.
- No searchService changes.
- No route or persisted preference changes.

## Rollback
- Remove local role state, role constants, chip component, and Help section header accessory.
