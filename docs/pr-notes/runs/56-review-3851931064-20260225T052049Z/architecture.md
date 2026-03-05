# Architecture Role Summary

## Decision
Use Firestore rules-level invariants for rideshare seat counters via parent-offer `get(...)` + `getAfter(...)` comparisons.

## Design
- Added helper `rideshareOfferPath(teamId, gameId, offerId)`.
- Added helper `isRideshareSeatCountUpdateValid(...)` to validate:
  - Offer exists before and after write.
  - Offer remains `open` and immutable core fields (`driverUserId`, `seatCapacity`, `status`) are unchanged.
  - Post-write `seatCountConfirmed` equals expected transition delta from request status change.
  - Seat count remains within `[0, seatCapacity]`.

## Why this over alternatives
- Enforces the same seat-capacity guarantees at the database boundary.
- Preserves existing client transaction model without schema migration.
- Limits blast radius to rideshare request/offer paths.

## Tradeoffs
- Requires status decision/deletion writes to include offer updates in the same atomic operation.
- Adds stricter field-diff checks that may reject previously permissive manual writes.
