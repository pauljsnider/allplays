## Plan
- Extend unit coverage first for the missing tournament-grade standings behaviors.
- Update `js/native-standings.js` to normalize the expanded schema, cap differential, and resolve tied groups by applicable tiebreaker stacks.
- Update `edit-team.html` to expose and persist the new standings fields with sensible defaults.

## Implementation Notes
- Keep the patch targeted to standings and edit-team configuration.
- Preserve existing saved configs by mapping legacy `tiebreakers` into both two-team and multi-team defaults.
- Prefer alias support for goal/point terminology so existing configs and tournament wording both work.

## Expected Files
- `js/native-standings.js`
- `tests/unit/native-standings.test.js`
- `edit-team.html`
- `tests/unit/edit-team-admin-access-persistence.test.js`
