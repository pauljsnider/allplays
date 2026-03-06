# Code Role Plan

1. Update `tests/unit/parent-dashboard-rsvp.test.js`:
   - Replace broad fallback expectation with ambiguous multi-child empty result.
   - Add single-child fallback test.
2. Update `js/parent-dashboard-rsvp.js` fallback logic for ambiguous contexts.
3. Bump `parent-dashboard.html` import query for `parent-dashboard-rsvp.js`.
4. Run targeted vitest file.
