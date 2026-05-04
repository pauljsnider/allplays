# QA Role Artifact

## Automated Coverage
Add targeted static HTML assertions for edit-schedule.html:
- future-only reminder timing copy exists
- explicit not-automatic-today copy exists
- immediate team chat notification copy exists
- key DOM IDs remain present
- notify-team controls have distinct visual grouping classes

## Manual Verification
- Open edit-schedule.html as coach/admin.
- Confirm reminder timing section states settings are stored for future automated delivery and not currently sent automatically.
- Confirm game/practice notify-team controls remain available and visually separate.
- Save game/practice with notify checked and unchecked to verify chat behavior remains unchanged.
- Save reminder timing defaults and verify no immediate chat message is created by settings save alone.
