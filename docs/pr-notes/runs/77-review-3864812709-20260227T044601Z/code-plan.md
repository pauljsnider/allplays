# Code Role Summary

## Implemented Patch
- Exported `runTransaction` from `js/firebase.js`.
- Hardened `redeemAdminInviteAtomicPersistence` in `js/db.js`:
  - require `codeId`
  - transactionally enforce invite invariants
  - update team admin list, user role, and code usage in one atomic transaction
- Hardened `redeemAdminInviteAcceptance` in `js/admin-invite-redemption.js`:
  - fail when `validation.codeId` is missing
- Added unit test for missing `codeId` in `tests/unit/admin-invite-redemption.test.js`.

## Notes
- Required allplays orchestration skills were not present in local skill inventory, so role outputs were produced directly and persisted in this run-scoped folder.
