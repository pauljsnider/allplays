Thinking level: medium
Reason: single-page workflow bug with low blast radius, but it needs a precise regression guard before editing inline logic.

Implementation plan:
1. Add a unit test in `tests/unit/` that inspects `track-statsheet.html` for the correct cancel and save semantics.
2. Update `track-statsheet.html` so `hideSummaryPreview()` clears `generatedSummary`.
3. Update the save handler to persist only `summary-notes.value.trim()`.
4. Run the focused unit test first, then the full unit suite if the focused run passes.
5. Stage the test, page change, and run-note artifacts, then commit with an issue-referencing message.
