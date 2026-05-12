# Architecture notes

Root cause is smoke fixture drift. `edit-schedule.html` now imports `sendPublicRsvpReminderEmails` from `js/schedule-notifications.js?v=5`, but the edit-schedule smoke stubs still modeled the older notification module. ES module linking fails before page initialization, leaving `#schedule-list` blank and preventing add/update call capture.

Minimal fix: update only the affected smoke stubs to match the current notification module export and route cache-bust version. Production edit-schedule code and schedule rendering architecture stay unchanged.
