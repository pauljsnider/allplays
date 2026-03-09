Implementation plan:
1. Update `js/utils.js` VEVENT finalization logic to keep sparse recurrence exceptions when `UID` and valid `RECURRENCE-ID` are present.
2. Extend `tests/unit/ics-recurrence-overrides.test.js` with sparse override and sparse cancellation regressions.
3. Run targeted Vitest coverage for the affected parser behavior.
4. Stage only the scoped files and commit with a short imperative message.
