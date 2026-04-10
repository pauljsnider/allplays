# Architecture Notes

Current state:
- ICS recurrence expansion in `expandRecurringICSEvent` mixes day iteration with fixed millisecond increments.
- `DAY_CODES` and `MS_PER_DAY` are declared later in file, creating temporal dead zone risk.

Proposed state:
- Declare recurrence constants (`DAY_CODES`, `MS_PER_DAY`) before ICS parsing/expansion functions.
- Use calendar-day date arithmetic (`setDate`) for cursor movement to preserve local wall time through DST.
- Compute week delta using calendar-day numbers, not raw millisecond division.
- Keep recurrence termination bounded by `COUNT`, `UNTIL`, and max occurrence guard only.

Risk and controls:
- Blast radius limited to recurrence helper logic in one file.
- Existing `MAX_ICS_RECURRENCE_OCCURRENCES` remains as safety guard.
