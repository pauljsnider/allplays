Current state:
- ICS ingest flows through `parseICS()` in `js/utils.js`.
- Edit Schedule imports external events via `mergeCalendarImportEvents()` and renders them with `renderCalendarEvent()`.
- Cancellation detection is split: status normalization in `getCalendarEventStatus()` plus action suppression in the renderer.

Recommendation:
- Keep the architecture unchanged.
- Add a tiny normalization in `parseICS()` so `SUMMARY` values are stored without raw folded whitespace artifacts; this makes cancellation prefix detection and downstream UI assertions more stable.
- Put the browser test on the real page with dependency stubs instead of extracting renderer code into a helper, because the issue is explicitly about visible/non-actionable behavior.

Tradeoffs:
- A Playwright smoke-style test is slower than unit-only coverage, but it directly proves the coach-visible branch.
- Leaving the renderer inline avoids broader refactoring and keeps blast radius small.

Rollback:
- Revert the single commit. No data migration or config rollback is needed.
