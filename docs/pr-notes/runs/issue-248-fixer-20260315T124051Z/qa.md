Coverage focus:
- Regression test that `requestRideSpot()` no longer uses merge semantics for re-requests and explicitly updates an existing declined or waitlisted request back to `pending`.
- Regression test that Firestore rules include a parent-owned re-request path with an open-offer guard and limited mutable fields.

Primary user scenario:
1. Parent requests a spot.
2. Driver marks the request `declined` or `waitlisted`.
3. Parent clicks `Request Spot` again.
4. The request returns to `pending` instead of failing with a permission error.

Guardrails:
- Active `pending` or `confirmed` requests should still not be re-requestable.
- Re-request must not modify ownership fields.
- Closed offers should still reject the action.

Validation:
- Run the targeted Vitest file first.
- Run the existing rideshare unit suite to confirm no helper or wiring regression.
