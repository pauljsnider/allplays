# Code Plan — Issue #4985

## Root Cause

`reserveNextTeamMediaOrder()` and `isTeamMediaUploadCounterUpdate()` both hard-code one-item increments. There is no exported bounded allocator for a future batch to claim one contiguous range in one transaction.

## Test-First Sequence

1. Extend `tests/unit/team-media-db-ordering.test.js` for exact ranges, bounds, early rejection, concurrent non-overlap, count-one compatibility, and failure gaps without duplicates.
2. Add emulator-backed delegated counter cases to `tests/unit/team-media-rules.test.js`, update its static contract assertions, and include it in rules-emulator CI.
3. Update `tests/unit/team-media-wiring.test.js` so it no longer freezes the obsolete exact `+1` rule.
4. Run focused tests to demonstrate failure before implementation.

## Minimal Implementation

- Export `reserveTeamMediaOrderRange(teamId, folderId, count = 1)` with strict integer 1–20 validation before `runTransaction`.
- In one transaction, read the folder once, derive a safe start counter, advance by `count`, and return every order in the range.
- Preserve a private `reserveNextTeamMediaOrder` wrapper delegating with count one so existing link/photo/file code and return contracts remain unchanged.
- Change delegated rules to require a non-negative integer current/requested counter and a delta of 1–20, preserving grant, visibility, field allowlist, and timestamp checks.

## Cache-Bust Plan

Raise the shared `db.js?v=4433202` production cohort, update exact-version tests/mocks, then follow every changed versioned JS importer transitively. Run `node scripts/check-critical-cache-bust.mjs` iteratively until the graph is fresh and uniform. No runtime consumer imports the new range export in this slice, so smoke stubs do not need a new export.

## Completion Checks

Run the three focused Team Media unit files, the Team Media rules file under the Firestore emulator, Firestore rules validation, and the critical cache-bust guard. Commit tests, implementation, rules, cache cohort, and role artifacts together with an issue-referencing message.
