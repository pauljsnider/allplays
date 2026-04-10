# Architecture Role Synthesis

## Current state
- `accept-invite.html` delegates invite handling to `createInviteProcessor`.
- `createInviteProcessor` uses `redeemAdminInviteAtomically` when present, else fallback persistence + `markAccessCodeAsUsed`.
- `redeemAdminInviteAtomically` transaction marks the access code as used.

## Proposed state
- Preserve current runtime behavior.
- Add guardrail test that verifies admin invite acceptance uses atomic redemption and surfaces used-code rejection correctly.

## Control equivalence
- Atomic transaction keeps admin grant + code consumption in one controlled write boundary.
- Shared processor keeps manual code and URL flows aligned.

## Rollback
- Revert targeted patch commit; no schema/data migration involved.
