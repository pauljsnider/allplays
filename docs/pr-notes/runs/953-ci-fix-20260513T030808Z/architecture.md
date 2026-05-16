# Architecture Notes

The edit-schedule page added imports for RSVP availability helpers: `getPlayers`, `getRsvps`, `buildAvailabilityReminderRecipients`, and `buildAvailabilityReminderEmailPreview`. The smoke tests replace production modules with inline ES module stubs; missing named exports prevent the page module from evaluating, so the schedule render and submit listeners never initialize.

Minimal fix: update only the affected smoke stubs so they match the page's current import contract. No production behavior change is required.

Rollback: revert the test stub additions if the page import surface changes again.
