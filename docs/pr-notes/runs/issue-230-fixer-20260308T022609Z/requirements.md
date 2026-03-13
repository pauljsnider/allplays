Objective: add schedule-native reminder and RSVP reminder controls in the schedule workflow without introducing backend infrastructure that does not exist in this repo.

Current state:
- Schedule CRUD lives in `edit-schedule.html`.
- Team messaging exists through `postChatMessage(...)`.
- There is no push/email reminder job pipeline in-repo.

Proposed state:
- Coaches/admins can configure per-team default reminder timing from the schedule surface.
- Game and practice save flows expose an explicit notify-team choice and optional note.
- RSVP detail view exposes a send-reminder action for the no-response group.
- Reminder intent and last-message metadata are stored on team/event records for auditability.

User requirements:
1. Saving a game or practice can optionally notify the team from the same schedule form.
2. Team default reminder timing supports the requested 24/48/72-hour choices.
3. RSVP reminder is accessible from the event RSVP modal and only appears when there are missing responses.
4. Existing CRUD and RSVP behavior must remain unchanged when notifications are not used.

Non-goals for this patch:
- Real push delivery.
- Real email fallback delivery.
- Background scheduled jobs.

Assumptions:
- Using team chat as the initial transport is acceptable because it is the only existing delivery primitive in-repo.
- Persisted reminder settings/intents now reduce future toil and create the contract for later backend delivery.
