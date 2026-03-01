# Code Role Notes

## Minimal Safe Patch
- Replace `selectedRideChildBySelector` with `selectedRideChildByOffer` map.
- Add `getRideOfferSelectionKey(teamId, eventId, offerId)` helper.
- Update `setRideChildSelection` to accept team/event/offer IDs and persist by stable key.
- Compute modal `selectedChildId` from stable key before `findRequestForChild` / `canRequestRide`.
- Update picker `onchange` to pass stable identifiers.

## Why This Fix
The eligibility and request-state computation now uses selection state bound to actual offer identity, so changing picker child updates controls for that offer reliably.
