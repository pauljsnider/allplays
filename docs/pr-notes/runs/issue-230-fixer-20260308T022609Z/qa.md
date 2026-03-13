Primary risk:
- Schedule save flows regress because new fields break add/update payloads.

Test strategy:
1. Add unit tests for the new helper module:
   - defaults normalize to a valid 24/48/72-hour reminder window
   - save/update/cancel/RSVP reminder messages are built with stable text
2. Add source-based schedule tests to assert:
   - team reminder settings controls are present
   - game/practice forms expose notify-team controls
   - RSVP modal wiring includes a no-response reminder action

Manual validation target:
1. Open `edit-schedule.html#teamId=...`
2. Save reminder defaults.
3. Create and edit a game with notify checked and unchecked.
4. Create a practice with notify checked.
5. Open RSVPs for an event with missing responses and send reminder.

Residual gaps:
- No true push/email delivery.
- No background execution of timed reminders yet; this patch establishes the contract only.
