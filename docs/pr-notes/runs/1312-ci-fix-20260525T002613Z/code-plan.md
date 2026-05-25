# Code plan

## Files
- `tests/unit/app-auth-profile-capabilities.test.js`

## Plan
1. Locate the profile capability parity assertion for invite code generation.
2. Replace the stale expected token `Generate code` with the current UI text `Generate invite link`.
3. Run targeted unit validation and full unit tests.

## Notes
Role subagent attempts timed out, so implementation proceeded from direct repository inspection and local test evidence.
