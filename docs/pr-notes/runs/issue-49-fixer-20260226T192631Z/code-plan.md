# Code Role Plan (Fallback)

Planned files:
- `js/accept-invite-flow.js` (new): extract testable invite processing logic from inline page module.
- `accept-invite.html`: import extracted helper and wire existing dependencies.
- `tests/unit/accept-invite-flow.test.js` (new): reproduce bug and verify fix.

Implementation steps:
1. Extract `processInvite` into dedicated module with dependency injection.
2. Add failing test asserting admin flow calls usage marker.
3. Patch admin flow to call `markAccessCodeAsUsed(validation.codeId, userId)`.
4. Run unit tests for changed area, then full unit suite.
