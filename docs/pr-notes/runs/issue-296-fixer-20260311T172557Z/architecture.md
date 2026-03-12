Current state:
- `edit-team.html` calls `inviteAdmin(...)` for existing teams, then only mutates local `adminEmails`.
- Team visibility and full-access checks read persisted `team.adminEmails`, not page-local state.

Decision:
- Introduce a small helper in `js/edit-team-admin-invites.js` that wraps `inviteAdmin`, `addTeamAdminEmail`, and optional email delivery.
- Use that helper from `edit-team.html` for existing-team invites.

Why this path:
- Smallest change on the real production entry point.
- Keeps persistence logic testable without trying to unit-test the whole HTML page.
- Avoids unrelated refactoring of the newer atomic acceptance path.

Controls:
- Email normalization stays lowercase.
- Persistence targets a single `teams/{teamId}` document.
- Failures still fail closed from the UI perspective because the local list is not updated unless persistence succeeds.
