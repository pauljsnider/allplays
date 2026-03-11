Implementation plan:
1. Bump `utils.js` import versions where the new calendar tracking helpers are imported.
2. Add a legacy recurring-event rideshare id helper in `parent-dashboard.html`.
3. Include `calendarEventUid` on ICS schedule events and pass legacy fallback ids into rideshare hydration and create flows.
4. Extend `js/db.js` rideshare read/create helpers to support fallback ids and annotate loaded offers with their source game id.
5. Run the available manual validation command path and commit only the scoped file changes.
