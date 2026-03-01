# Code role plan (fallback inline)

1. Update `firestore.rules`:
   - add `seatCountConfirmed` delta cap in `rideOffers/{offerId}` update (if absent).
   - ensure `requests` create requires open offer status.
   - restrict request-owner update branch to non-status metadata edits while pending only.
2. Update `parent-dashboard.html`:
   - derive selected child from picker state via helper.
   - compute `myRequest` and `canRequest` from selected child for modal path.
3. Validate via syntax/read checks and targeted grep.
4. Commit scoped changes.
