Current state:
- `edit-schedule.html` directly posts a hard-coded cancellation chat message.
- Team docs do not store schedule reminder defaults.
- Event docs do not store schedule notification metadata.

Proposed state:
- Add a small pure helper module to normalize schedule notification settings and build message text.
- Store team defaults under `team.scheduleNotifications`.
- Store event-level metadata under `event.scheduleNotifications`.
- Use existing `postChatMessage(...)` as the transport for save/cancel/RSVP reminder actions.

Scope:
- `edit-schedule.html`
- new `js/schedule-notifications.js`
- targeted unit tests

Blast radius:
- Low to moderate. Touches only schedule UI and event/team document payloads.
- No Firestore rules or backend function changes.

Controls:
- Explicit user opt-in on save before sending a message.
- Event metadata records reminder hours, transport, last action, and last sent timestamp/user.
- Team-level defaults are stored centrally instead of relying on coach memory.

Rollback:
- Revert this patch to return to prior chat-only cancellation behavior with no schedule notification metadata.
