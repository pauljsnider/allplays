Objective: remediate PR #252 review thread PRRT_kwDOQe-T585y6Fnc without broad parser changes.

Current state: `parseICS()` only retains VEVENTs that include both `DTSTART` and `SUMMARY`.
Proposed state: preserve detached recurrence exceptions when they include `UID` and `RECURRENCE-ID`, even if unchanged fields are omitted.

Risk surface: ICS import behavior in `js/utils.js` recurrence handling.
Blast radius: limited to VEVENT admission before `buildICSOccurrences(...)`; downstream logic already handles sparse overrides and cancelled instances.

Assumptions:
- Detached exceptions always include `UID` and `RECURRENCE-ID`.
- Master events still provide the base fields merged into sparse overrides.
- Existing non-recurring event filtering should remain unchanged.

Recommendation: change the end-of-VEVENT guard to admit recurrence exceptions with `UID` + valid `RECURRENCE-ID`, and add regression tests for sparse moved and cancelled exceptions.
