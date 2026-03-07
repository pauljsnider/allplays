Current state:
- `edit-schedule.html` contains a shared `formatIsoForInput()` helper that converts a stored instant into the local string required by `datetime-local`.
- Some schedule edit paths use the helper, while another editable schedule row still uses `date.toISOString().slice(0, 16)`.

Proposed state:
- Reuse the shared helper for the remaining editable datetime field instead of open-coding UTC serialization.

Blast radius:
- Single page, single rendering branch in the schedule editor.
- No data model changes, no API changes, no Firebase contract changes.

Tradeoff:
- Minimal patch with low regression risk versus a larger refactor of all date formatting on the page.

Rollback:
- Revert the single helper substitution commit if the schedule preview renders unexpectedly.
