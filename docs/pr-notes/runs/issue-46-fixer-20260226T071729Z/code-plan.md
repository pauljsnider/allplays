# Code Role Plan Synthesis (fallback, no sessions_spawn available)

## Implementation plan
1. Add a new unit test file for ICS timezone parsing, initially asserting failing TZID behavior.
2. Update `parseICS` field parsing to retain `TZID` parameter and pass into `parseICSDate`.
3. Implement `parseICSDate(icsDate, timeZone)` with timezone-aware conversion helper for IANA zones.
4. Run targeted and full unit tests; fix edge failures if any.
5. Commit tests + fix together with issue reference.

## Constraints
- Keep patch minimal and isolated.
- No refactor outside ICS parsing path.
