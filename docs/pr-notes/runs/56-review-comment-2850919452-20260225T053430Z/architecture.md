# Architecture Role Notes

## Current State
Selection state is keyed by UI selector IDs, which are render-coupled.

## Proposed State
Store picker selection by stable domain key: `teamId::eventId::offerId`.

## Blast Radius
- Scoped to rideshare modal/list rendering in `parent-dashboard.html`.
- No Firestore schema or API changes.

## Control Equivalence
- Preserves existing request/cancel APIs.
- Improves determinism by decoupling selection state from ephemeral DOM IDs.
