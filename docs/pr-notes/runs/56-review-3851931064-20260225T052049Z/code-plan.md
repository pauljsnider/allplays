# Code Role Summary

## Patch Scope
- File: `firestore.rules` only.

## Implemented Changes
- Added rideshare offer path helper and seat-update validation helper.
- Hardened `rideOffers/{offerId}/requests/{requestId}` update rule:
  - Driver/admin decisions now require strict field diff and seat-count invariant validation.
  - Parent path constrained to pending-only metadata edits.
- Hardened delete rule to require seat-count invariant validation (prevents delete-induced drift).

## Non-Goals
- No app-layer API or UI changes.
- No schema/index changes.
