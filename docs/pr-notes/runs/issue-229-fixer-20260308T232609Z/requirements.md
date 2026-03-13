Objective: stop cancelled recurring practice occurrences from reappearing on parent-facing schedule and packet surfaces when a linked practice session still exists.

Current state:
- `expandRecurrence()` correctly omits cancelled recurrence dates via `exDates`.
- `parent-dashboard.html` re-adds unmatched `practiceSessions` as standalone practice events.
- Practice packet rows are built directly from `practiceSessions` and ignore cancellation state.

Proposed state:
- Parent-facing fallbacks must suppress `practiceSessions` that map to cancelled practices, including cancelled recurrence instances (`masterId__YYYY-MM-DD` where the master contains the same date in `exDates`).
- The same rule must apply to the schedule list/calendar and the Practice Attendance & Home Packet card.

Risk surface and blast radius:
- Affects parent dashboard practice rendering only.
- No coach scheduling writes or recurrence expansion behavior changes.
- Primary regression risk is hiding legitimate draft sessions that are intentionally not yet on the schedule.

Assumptions:
- Recurring practice session `eventId` values use the existing `masterId__YYYY-MM-DD` convention.
- Cancelled one-off practice records may use `status: cancelled` on the linked game/practice document.
- Unlinked draft sessions without a matching cancelled event should remain visible.

Recommendation:
- Add a shared helper that determines whether a `practiceSession` is linked to a cancelled practice occurrence or cancelled practice event.
- Reuse it in both parent dashboard fallback paths to preserve one decision rule.

Success criteria:
- Cancelled recurring occurrences with existing `practiceSessions` no longer appear in upcoming schedule results.
- The Practice Attendance & Home Packet card also excludes those cancelled sessions.
- Legitimate unmatched draft sessions still appear.
