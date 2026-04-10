# QA Role (manual fallback)

## Primary regression target
- `signup()` should reject when `updateUserProfile` fails after successful invite redeem.

## Test updates
- Update existing unit test that currently expects resolve-on-profile-failure.
- Assert rejection and that rollback path still executes (`rollbackParentInviteRedeem` called).

## Validation scope
- Run parent-invite signup auth suite.
- Run parent-invite helper suite to ensure no regression in redeem/finalize internals.
