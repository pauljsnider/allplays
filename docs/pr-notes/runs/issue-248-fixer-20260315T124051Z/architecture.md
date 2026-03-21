Decision: keep the stable request document key and support re-request as a constrained in-place update.

Why:
- Changing request IDs would ripple through helper lookups, UI hydration, and historical request handling.
- A controlled update keeps the blast radius to one function and one Firestore rule branch.

Implementation shape:
- `requestRideSpot()` reads the existing request doc.
- If no doc exists, it creates a normal pending request.
- If the doc exists in `declined` or `waitlisted`, it updates only `childName`, `status`, `requestedAt`, `respondedAt`, and `updatedAt`.
- Firestore rules mirror that exact field-level contract and require the offer to remain open.

Controls:
- Only the request owner can re-request.
- `parentUserId` and `childId` stay immutable.
- Seat counts remain controlled by driver/admin-only status decisions.

Rollback:
- Revert the new update branch in `requestRideSpot()`.
- Remove the matching parent re-request rule clause.
