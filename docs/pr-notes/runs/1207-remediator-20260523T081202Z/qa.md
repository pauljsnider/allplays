# QA Notes

## Validation Plan
- Run the focused Node test file for account merge core logic.
- Verify the helper detects duplicate non-empty `userId` entries and ignores empty/missing IDs.
- Verify `buildMergedPlayerParents` still deduplicates source-to-destination retries and existing duplicate destination entries.

## Edge Cases Covered
- Source and destination entries collapse to one destination entry.
- Existing duplicate destination entries collapse to one destination entry.
- Duplicate detector flags unresolved duplicate user IDs if future merge logic regresses.

## Command
- `node --test functions/test/account-merge-core.test.cjs`
