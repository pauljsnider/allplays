# QA analysis

## Regression coverage
Focused Parent Tools tests cover:
1. Active and pending organizer-owned controls.
2. No controls for read-only contacts, other organizers, or removed memberships.
3. Confirmation naming caregiver and player.
4. Cancellation with zero mutation.
5. Successful revoke followed by model refresh/removal.
6. Premium-locked creation with revocation still enabled.
7. Failed revoke preserving the card, showing retry UI, and succeeding on retry.

The existing `parentHouseholdService.test.ts` already covers adapter delegation, missing membership IDs, and propagated adapter errors.

## Validation
Run the focused component and service tests, then the app typecheck. GitHub CI remains the broad gate.
