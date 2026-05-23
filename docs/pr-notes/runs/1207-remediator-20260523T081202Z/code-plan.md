# Code Plan

## Files
- `functions/account-merge-core.cjs`
- `functions/index.js`
- `functions/test/account-merge-core.test.cjs`

## Implementation
1. Export a `findDuplicateParentUserIds(parents)` helper from the account merge core module.
2. Import and call it inside `confirmParentAccountMerge` immediately after computing `result = buildMergedPlayerParents(...)` for each transaction-read player document.
3. Throw `HttpsError('failed-precondition', ...)` if the candidate final parents array contains duplicate non-empty user IDs.
4. Add focused tests for duplicate detection and deduping existing duplicate destination parent entries.

## Validation
- Run `node --test functions/test/account-merge-core.test.cjs`.
