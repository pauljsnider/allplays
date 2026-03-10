Chosen thinking level: medium.

Implementation plan:
1. Add a failing unit test for global-calendar ICS event shaping.
2. Export a focused helper from `js/utils.js` that builds the global-calendar event object from a parsed ICS event.
3. Replace the inline mapping in `calendar.html` with the helper.
4. Run the unit tests and commit the targeted patch.
