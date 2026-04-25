# Acceptance Criteria
- The smoke test can navigate the schedule calendar after switching between filters and list/calendar views without assuming a stale visible month.
- The past-events calendar view still shows cancelled events in the correct month.
- No application behavior changes outside this smoke-path fix.

# Architecture Decisions
- Treat this as a test harness issue, not a product regression.
- Keep production code unchanged because `team.html` intentionally resets the calendar month to the first filtered event when entering calendar view.
- Update the smoke helper to derive navigation from the visible `#schedule-calendar-month-label` instead of the caller's prior assumption.

# Risks And Rollback
- Risk is low and isolated to smoke coverage. The helper becomes more accurate to actual UI state.
- Rollback is a single-file revert of `tests/smoke/team-schedule-calendar.spec.js` if this introduces broader smoke instability.
