Objective: preserve the originally scheduled local practice time when an existing practice or recurring practice is opened and saved from `edit-schedule.html`.

Current state:
- Existing practice timestamps are stored correctly.
- The edit UI historically risked displaying UTC-adjusted values in `datetime-local` fields, which can silently shift the saved time on update.

Proposed state:
- Practice edit inputs always show the same local wall-clock time the coach originally scheduled.
- Saving without changing the time preserves the stored start and end exactly.

Risk surface and blast radius:
- High user-facing scheduling impact.
- Recurring practice edits can affect an entire series, so the fix must stay narrowly scoped to datetime-local prefill behavior.

Assumptions:
- Stored practice timestamps are canonical and should not be rewritten unless the coach edits them.
- Browser `datetime-local` inputs expect a local wall-clock string, not a UTC ISO string.

Recommendation:
- Keep the fix targeted to local-input formatting and add a regression test that executes the extracted edit-schedule logic under a non-UTC timezone.
