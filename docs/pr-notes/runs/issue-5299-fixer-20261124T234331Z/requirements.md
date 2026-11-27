# Requirements Analysis — Issue #5299

The requested `allplays-requirements-expert` skill was unavailable, so this artifact records the equivalent requirements-role review.

## Acceptance interpretation

- Aggregate validation must evaluate the complete intended Firebase function target set.
- Every intended target must have authoritative evidence classified by the existing verifier as `current`, `updated`, or `unchanged`.
- A mixed set is valid only when every target has one of those supported states.
- The aggregate must fail closed when any intended target has missing, malformed, unsupported, or identity-mismatched evidence.
- Existing single-target and application-level behavior must remain compatible. Hosting, quota-pressure metadata, retry artifacts, and workflow gating remain out of scope.

## Root cause

`verifyFirebaseApplicationDeployment` validates only one evidence object against one expected deployment. The individual verifier recognizes the three authoritative states, but no aggregate path binds a complete evidence collection to the complete intended target inventory.

## Required regressions

1. Accept a mixed aggregate containing current, updated, and unchanged targets.
2. Reject the aggregate when one target has unsupported evidence.
3. Reject an intended target with no corresponding evidence.
4. Preserve the existing individual-target regressions.

The prevention-oriented assertion is that one unsupported member invalidates the entire aggregate even when every other member is authoritative.
