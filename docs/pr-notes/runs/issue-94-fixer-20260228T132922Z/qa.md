# QA role synthesis (fallback)

Regression targets:
- Weekly recurrence with `interval = 2` and one `byDays` value should skip alternating weeks.
- Weekly recurrence with multiple `byDays` values should include all selected days only in valid interval weeks.
- Daily recurrence should remain unaffected.

Validation plan:
- Add unit tests against `expandRecurrence` in `tests/unit`.
- Use fixed system time to keep windowing deterministic.
- Run targeted vitest file for fast feedback.
