# Code Plan

- In `AppSearchDialog.tsx`, derive filtered `helpResults` from `results.help` and `selectedHelpRole`.
- Derive `flatResults` from the displayed sections and use it for active-index bounds, arrow navigation, Enter, and no-results empty state.
- Update the app-search integration test to verify filtering and Enter navigation for selected help roles.
