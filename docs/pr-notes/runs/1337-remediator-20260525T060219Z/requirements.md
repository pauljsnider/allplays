# Requirements notes

## Acceptance criteria
- RSVP reminder send controls match the backend email API: global admins, team owners, and team `adminEmails` may send reminders; coach-only staff must not see or invoke the send action.
- A callable result with `sentCount: 0` is preserved as zero in UI result data and persisted metadata.
- Recurring practice occurrence reminders do not fail after side effects because metadata writes target the persisted master event instead of a virtual occurrence id.

## Non-goals
- Do not broaden backend authorization.
- Do not refactor unrelated schedule staff permissions.
