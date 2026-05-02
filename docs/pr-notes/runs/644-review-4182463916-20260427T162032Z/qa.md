# QA Review

## Regression Guardrails
- Preserve disabled rollover state across admin add/remove rerenders.
- Preserve individual staff deselections across admin add/remove rerenders.
- Confirm source-team changes reset the preview defaults.
- Confirm manually added admins are not duplicated by rollover.
- Confirm saved `adminEmails` matches visible UI selections.

## Validation Commands
```bash
npm test -- --run tests/unit/rollover-access.test.js tests/unit/edit-team-admin-access-persistence.test.js
```

## Manual Workflow
Create a new team, choose a rollover source, deselect one staff admin, add and remove a manual admin, then save. Verify the deselected staff admin is not in the saved `adminEmails` and rollover audit includes only selected staff.
