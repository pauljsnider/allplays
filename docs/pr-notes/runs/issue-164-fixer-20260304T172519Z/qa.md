# QA Role Synthesis

## Regression focus
- Standard signup: claim failure from concurrent loser must reject signup and cleanup auth account.
- Parent invite redemption: source guard confirms transaction claim in function body.

## Test plan
- Unit test in `tests/unit/signup-flow.test.js` for non-parent/non-admin flow where `markAccessCodeAsUsed` rejects.
- Unit source-guard test in `tests/unit/access-code-atomic-redemption-guard.test.js` asserting:
  - `markAccessCodeAsUsed` uses `runTransaction`.
  - `redeemParentInvite` uses `runTransaction`.

## Manual spot checks (post-merge)
- Two concurrent signups with same standard code: one success, one failure.
- Two concurrent parent dashboard redeems with same parent invite: one success, one failure.
