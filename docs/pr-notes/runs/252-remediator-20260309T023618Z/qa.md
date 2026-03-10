Validation target:
- Confirm sparse override VEVENTs with `RECURRENCE-ID` survive parsing.
- Confirm sparse cancellation VEVENTs suppress the generated master occurrence.

Planned evidence:
- Unit test for moved instance that omits unchanged `SUMMARY`.
- Unit test for cancelled instance that contains only `UID`, `RECURRENCE-ID`, and `STATUS:CANCELLED`.
- Run targeted Vitest file for recurrence overrides.

Residual risk:
- ICS feeds missing `UID` cannot be reconciled and will still be ignored. That is acceptable because override mapping depends on `UID`.
