# Architecture notes

## Decisions
- Keep general staff schedule visibility separate from RSVP reminder send permission.
- Add an event-level `isTeamRsvpReminderManager` flag derived from backend-compatible team ownership/admin-email checks.
- Use a helper for sent-count resolution so nullish fallback does not mask explicit zero.
- Resolve virtual ids of the form `masterId__instanceDate` to the persisted master doc for metadata writes, while recording occurrence-specific metadata under `scheduleNotifications.rsvpReminderOccurrences`.

## Blast radius
- Scoped to RSVP reminder panel/action and schedule notification metadata writes.
