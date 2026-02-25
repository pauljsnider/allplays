# Code Role Plan

## Minimal Safe Patch
- File: `firestore.rules`
- Scope: `match /rideOffers/{offerId}` `allow update` predicate
- Change: add absolute-delta guard for `seatCountConfirmed` against existing value

## Why This Patch
Implements reviewer-requested mitigation with one localized rule condition and no JS behavior changes.

## Acceptance Criteria
- Rules compile with `math.abs(...)` expression.
- Branch includes only targeted rule change plus required run-note artifacts.
