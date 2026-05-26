# Code Plan

Implementation Plan
- Add `isTeamRsvpReminderManager` to schedule event models and populate it from owner/admin/global-admin checks.
- Keep `isTeamStaff` for broader staff visibility including coachOf.
- Change reminder assertion/UI wiring to use `isTeamRsvpReminderManager`.
- Replace `sentCount || fallback` with `resolveStaffRsvpReminderEmailSentCount()`.
- Update reminder metadata writes to target the persisted master ID for `id__occurrence` events and store occurrence metadata.
