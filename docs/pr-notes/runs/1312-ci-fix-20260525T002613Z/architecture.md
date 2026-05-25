# Architecture notes

## Root cause
The React profile page invite UI changed its user-facing copy from "Generate code" to "Generate invite link", while the capability parity unit test still asserted the older token. The implementation already exposes the invite-link generation capability.

## Minimal change
Update the unit parity assertion to match the current React profile UI copy. No runtime architecture or data model change is required.

## Risk and rollback
Risk is limited to test coverage wording. Rollback is reverting the one-line test assertion change if product copy intentionally returns to "Generate code".
