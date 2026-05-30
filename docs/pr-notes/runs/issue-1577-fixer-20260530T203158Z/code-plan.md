# Code Plan

## Implementation
- Add `HelpRoleFilter` type and `helpRoleFilters` options in `AppSearchDialog.tsx`.
- Add `selectedHelpRole` state initialized to `all` and reset on dialog open.
- Add `HelpRoleFilterChips` component using a labelled button group and `aria-pressed`.
- Extend `SearchSection` with optional `headerAccessory` and render it in a wrap-friendly header.
- Pass the chip component only to the Help section.

## Test
- Add a focused unit/integration test in `tests/unit/app-search-integration.test.jsx` for chip rendering and state changes.

## Scope Guard
- Do not modify `searchService.ts` or help result filtering logic.
