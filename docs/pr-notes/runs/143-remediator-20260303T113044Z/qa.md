# QA Notes

Validation targets:
- Daily recurrence with EXDATE removing only occurrence should return zero events.
- Weekly recurrence with DTSTART in DST-observing timezone should keep same local wall clock across DST shift.
- Weekly COUNT with large interval (e.g., INTERVAL=52, COUNT=20) should not truncate early.
- No runtime ReferenceError from constant pre-definition reads.

Execution:
- Repo has no automated test runner in AGENTS/CLAUDE; use targeted static validation and existing lint-free checks via code inspection.
