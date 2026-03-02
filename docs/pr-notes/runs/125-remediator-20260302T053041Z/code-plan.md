# Code role plan (manual fallback)

1. Modify `js/parent-dashboard-rsvp.js` to throw when submission scope resolves to zero player IDs.
2. Keep valid explicit/single-child paths unchanged.
3. Update `tests/unit/parent-dashboard-rsvp.test.js` to assert throw behavior for invalid/ambiguous scope.
4. Run the targeted test file.
