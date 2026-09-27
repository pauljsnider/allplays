# Code Plan

## Objective

Add callable-level Firestore emulator coverage proving the required rejection paths return one privacy-safe error and perform zero writes.

## Minimal patch

1. Generalize the emulator snapshot helper for existing and absent documents.
2. Add a rejection fixture helper that seeds a unique invite, recipient, optional existing friendship, and payload-derived friendship refs.
3. Snapshot all relevant refs before invoking the callable.
4. Assert the generic metadata-free rejection.
5. Snapshot the same refs afterward and require deep equality.
6. Add identity mismatch with payload substitution, self-redemption, expiration, prior-use, and blocked-friendship cases.

## Production code decision

Do not change `functions/friend-invite-redemption-core.cjs` preemptively. Current validation ordering keeps rejection gates before writes. Change it only if a focused emulator regression demonstrates a write or metadata leak.

## Failure modes guarded

- Dereferencing update time for an absent friendship.
- Computing the wrong friendship path for self-redemption.
- Missing same-value writes by comparing data without update time.
- Testing the transaction without the callable Auth boundary.
- Checking only one payload identity field.
- Treating skipped emulator tests as integration validation.

## Commit scope

- `functions/test/friend-invite-redemption.test.cjs`
- `docs/pr-notes/runs/issue-4417-fixer-20260803T055329Z/`
- Proposed commit: `Test zero-write friend invite rejections (#4417)`
