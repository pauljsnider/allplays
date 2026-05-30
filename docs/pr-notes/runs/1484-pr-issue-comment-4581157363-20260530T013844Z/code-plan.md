# Code Plan

## Patch
- Add a per-team `hasTeamAdminAccess` gate in `functions/index.js` inside `publishOrganizationScheduleDraft`.
- Place it after team existence and organization-boundary validation, before `admin.firestore.Timestamp.now()`, `firestore.batch()`, and all `batch.set` calls.
- Throw `permission-denied` with a clear team-admin message.
- Update `tests/unit/organization-schedule.test.js` to assert the guard, message, and ordering before batch creation.

## Files
- `functions/index.js`
- `tests/unit/organization-schedule.test.js`
- `docs/pr-notes/runs/1484-pr-issue-comment-4581157363-20260530T013844Z/*`
