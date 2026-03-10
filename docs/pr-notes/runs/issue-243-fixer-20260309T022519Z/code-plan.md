Chosen thinking level: medium
Reason: parser behavior is shared across multiple pages, but the bug is localized and already reproducible with a focused fixture.

Implementation plan:
1. Add a failing unit test for RRULE + `RECURRENCE-ID` override replacement semantics.
2. Refactor `parseICS(...)` to collect raw VEVENTs, then resolve masters and overrides in a post-processing pass.
3. Assign stable occurrence IDs for expanded recurring events using UID plus occurrence anchor timestamp.
4. Run focused Vitest coverage for recurrence parsing and calendar fetch.

Fallback path:
- If override reconciliation causes unexpected regressions, limit the fix to instance IDs and document the remaining exception gap for follow-up.
