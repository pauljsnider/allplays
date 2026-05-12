# Code plan

1. Add `sendPublicRsvpReminderEmails` to the schedule notification stubs in the two affected smoke specs.
2. Update the cancelled-import spec route from `schedule-notifications.js?v=4` to `?v=5` so the stub is used for the current page import.
3. Run targeted smoke tests where Playwright browsers are available, then commit with the required CI-fix message.
