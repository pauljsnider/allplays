# Code role synthesis (fallback)

Plan:
1. Add a new unit test file for recurrence interval behavior in `tests/unit`.
2. Reproduce bug with weekly `interval=2` expecting biweekly dates.
3. Patch `expandRecurrence` to apply weekly interval gating by week offset from series start.
4. Run targeted tests.
5. Commit docs + tests + fix with issue reference.

Constraints:
- Minimal patch only; no unrelated refactors.
- Preserve existing recurrence end-condition behavior (`count`, `until`, `exDates`, overrides).
