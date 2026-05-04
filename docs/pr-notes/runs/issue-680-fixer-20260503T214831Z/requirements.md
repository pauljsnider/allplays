# Requirements Role Artifact

## Acceptance Criteria Mapping
- Page copy must not imply timed reminders are delivered today.
- Immediate notify-team behavior remains available for games, practices, and import where currently supported.
- Notify-team UI must be visually distinct from reminder timing settings.
- Reminder timing copy must explicitly state timing is stored for future reminder delivery and not currently sent automatically.

## User Needs
- Coaches/admins need confidence that notify-team posts a team chat update now.
- Coaches/admins must understand reminder timing is metadata for future automated delivery, not active automation today.
- Parents should not expect scheduled push/email/chat reminders unless a coach/admin explicitly sends an immediate notification or manual RSVP reminder.

## Edge Cases
- Reminder timing enabled with notify-team unchecked saves metadata only and sends no immediate chat message.
- Notify-team checked while reminders disabled still sends immediate chat message.
- CSV import notify, if present, should be framed as immediate chat notification only.
- Manual RSVP reminder copy can remain if clearly user-triggered.
- Existing saved reminder settings require no migration.
