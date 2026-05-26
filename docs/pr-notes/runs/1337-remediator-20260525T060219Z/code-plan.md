# Code plan

## Minimal changes
- `scheduleLogic.ts`: add reminder send-count and metadata-target helpers; extend `ParentScheduleEvent`.
- `scheduleService.ts`: add backend-compatible manager check, populate `isTeamRsvpReminderManager`, use helpers for metadata and sent counts.
- `ScheduleEventDetail.tsx`: gate the reminder panel on `isTeamRsvpReminderManager`.
- `schedule-rsvp-reminder.test.js`: add focused regression coverage.
