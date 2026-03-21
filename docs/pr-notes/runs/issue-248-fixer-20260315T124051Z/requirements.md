Objective: restore the parent rideshare re-request flow for existing declined or waitlisted requests without broadening access beyond the request owner.

Current state:
- The dashboard shows `Request Spot` again when `canRequestRide()` sees seats available and no active pending or confirmed request.
- The write path always reuses the stable request document ID, so a re-request is an update.
- Firestore rules only let parents edit `childName` while status is already `pending`, which rejects the re-request.

Proposed state:
- Keep the UI behavior.
- Allow the request owner to move only their own `declined` or `waitlisted` request back to `pending` while the offer remains open.
- Treat the re-request as a fresh pending request by clearing `respondedAt` and refreshing `requestedAt`.

Risk surface and blast radius:
- Limited to `rideOffers/{offerId}/requests/{requestId}` updates by the original parent.
- No expansion of seat-count authority.
- No change to driver/admin decision powers.

Assumptions:
- Re-requesting should preserve the stable request doc ID.
- Refreshing `requestedAt` is the desired queue semantics for a renewed request.
- The offer must still be open for the re-request to succeed.

Recommendation:
- Add a narrowly scoped parent update rule for `declined` or `waitlisted` to `pending`.
- Update `requestRideSpot()` to branch between create and controlled update so the client write matches the rule contract.
