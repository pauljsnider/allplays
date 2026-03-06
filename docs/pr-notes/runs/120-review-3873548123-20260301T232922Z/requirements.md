# Requirements Role Summary

## Objective
Fix orphaned Firebase Auth accounts when parent-invite signup fails during profile creation.

## Current State
- Parent-invite signup creates Firebase Auth user first.
- If `updateUserProfile` fails, the error is rethrown but the auth user remains.

## Proposed State
- On parent-invite finalization failure, perform best-effort auth cleanup before rethrowing the original error:
  - delete newly created auth user
  - sign out current session

## Risk Surface and Blast Radius
- Scope limited to parent-invite signup failure path in `signup`.
- Low blast radius; no success-path behavior change.

## Acceptance Criteria
- Failed parent-invite profile write rethrows original error.
- Auth user cleanup delete is attempted.
- Sign-out is attempted even if delete fails.
- Verification email is not sent on failure.
