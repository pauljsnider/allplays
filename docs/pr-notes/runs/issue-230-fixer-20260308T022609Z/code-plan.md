Thinking level: medium
Reason: multi-surface UI/persistence change, but constrained to one page and a pure helper.

Plan:
1. Add failing tests for schedule reminder helper behavior and required `edit-schedule.html` controls/wiring.
2. Create `js/schedule-notifications.js` with normalized defaults and message builders.
3. Update `edit-schedule.html` to:
   - render team reminder settings
   - persist `team.scheduleNotifications`
   - persist `event.scheduleNotifications`
   - send optional team messages on game/practice save
   - send RSVP reminder messages from the RSVP modal
4. Run targeted Vitest files, then the full unit suite if time permits.
5. Commit all test + fix changes referencing issue #230.
