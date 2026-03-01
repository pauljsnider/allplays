# Architecture Role Summary

## Decision
Apply minimal, control-preserving patch at rules and presentation layers.

## Design Notes
- Rules: add parent-offer status guard on `requests` `allow create` via `get(...rideOffers/{offerId}).data.status == 'open'`.
- UI: track selected child per offer row with `selectedRideChildBySelector` map and rerender modal on selection change.

## Control Equivalence
- New rules check strengthens DB-level control without reducing existing access checks.
- UI change aligns action visibility with real eligibility and existing helper logic (`canRequestRide`, `findRequestForChild`).

## Rollback
- Revert single guard line in `firestore.rules` and selected-child state block in `parent-dashboard.html`.
