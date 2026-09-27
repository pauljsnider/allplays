# Code Plan

## Patch Plan

1. Replace the obsolete static expectation that linked parents may directly create co-parent invites.
2. Add emulator-backed denial tests and unaffected-operation success controls.
3. Remove the co-parent create branch and its now-unused helper from `firestore.rules`.
4. Add the focused test to the emulator-backed CI script.
5. Run focused rules, co-parent workflow, and callable-core checks.

## Code Changes Applied

- Removed the direct `coparent_invite` create alternative and its unused payload helper.
- Added static and emulator regression coverage for direct-create denial.
- Added emulator success controls for standard and `parent_invite` creation.
- Registered the access-code rules test in the emulator-backed CI script.

## Validation Run

Passed:

- `firebase emulators:exec --only firestore --project demo-allplays "npx vitest run tests/unit/access-code-rules.test.js --reporter=verbose --no-file-parallelism"`
- `npx vitest run tests/unit/co-parent-invite-workflow.test.js tests/unit/accept-invite-flow.test.js tests/unit/public-user-profile-sync.test.js --reporter=verbose`
- `node --test functions/test/co-parent-invite-core.test.cjs functions/test/parent-invite-auto-link-callable.test.cjs`

## Residual Risks

- Admin SDK behavior cannot be proven by client rules tests, so existing callable-core coverage remains the server-path guard.
- The legacy parent dashboard remains on the direct-write helper and will be denied until migrated separately.

## Commit Message Draft

`Deny direct co-parent invite creation (#4306)`

## Risks And Rollback

The rules change is narrow and reversible by restoring the removed branch. Rollback would reopen the callable bypass, so the preferred recovery for unexpected legacy traffic is to migrate that caller rather than weaken the boundary.
