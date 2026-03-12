Coverage focus:
- Unit test shared team-access helper with profile-email fallback.
- Static wiring test that `dashboard.html` passes profile email fallback into `getUserTeamsWithAccess(...)`.

Manual spot-check after deploy:
1. Accept an admin invite for a user whose runtime auth object does not expose email on first load.
2. Confirm the team appears on `dashboard.html`.
3. Confirm `edit-team.html` and `edit-roster.html` load without access denial.

Regression risks:
- Accidentally broadening access beyond owner/admin-email/platform-admin.
- Dashboard discovering the wrong teams if email normalization changes.
