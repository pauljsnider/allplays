# Requirements Role Summary

## Objective
Close the Firestore-rule integrity gap where rideshare confirmations can be written without synchronized seat-capacity enforcement at rule-evaluation time.

## Current State
- App code uses `runTransaction` for `seatCountConfirmed` updates.
- Rules allow request status changes (`confirmed`, `waitlisted`, `declined`) without requiring a matching parent-offer seat update in the same atomic write.

## Proposed State
- Any request decision or deletion must satisfy seat-count transition math against the parent offer document using `getAfter(...)`.
- Parent-owned request edits remain limited to pending-state metadata updates.

## Risk / Blast Radius
- Scope: `firestore.rules` rideshare request update/delete logic.
- Impacted users: ride drivers, team staff, and parents in rideshare workflows.
- Reduced risk: prevents oversubscription and seat-count drift caused by out-of-band request writes.

## Assumptions
- Request status lifecycle is `pending -> confirmed|waitlisted|declined` for driver/admin decisions.
- Parent cancellation path is delete-based and already transaction-coupled in app code.

## Success Criteria
- Rules deny request confirmation when the same commit does not provide a consistent parent-offer `seatCountConfirmed` update.
- Rules continue to allow valid transaction-based status updates and cancellation deletes.
