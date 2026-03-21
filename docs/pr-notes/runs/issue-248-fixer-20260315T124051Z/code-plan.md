Minimal patch plan:
1. Add a unit test file that asserts the desired `requestRideSpot()` branch and matching Firestore rule snippets.
2. Update `requestRideSpot()` to:
   - create when no request exists
   - update when the existing request is `declined` or `waitlisted`
   - reject other existing active states
3. Extend Firestore request update rules for parent-owned re-requests back to `pending` while the offer is open.
4. Run targeted unit tests, then the rideshare-related unit tests, then commit.
