Chosen thinking level: low
Reason: the underlying helper behavior already exists in the current codebase; the remaining work is a narrow regression guard plus cache invalidation.

Implementation plan:
1. Add a failing page-level unit test for `calendar.html` that requires `buildGlobalCalendarIcsEvent(...)` usage and rejects a hard-coded `status: 'scheduled'` ICS mapping.
2. Update `calendar.html` to bump the `js/utils.js` import version so browsers pull the helper that preserves cancelled ICS state.
3. Run the focused calendar ICS unit tests.

Fallback path:
- If the page-level test proves too brittle, keep the helper-level test and add a narrower assertion around the exact ICS merge block in `calendar.html`.
