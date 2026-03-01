# Architecture Role Notes (Issue #53 Rideshare)

## Objective
Introduce rideshare coordination without changing existing game/practice scheduling and RSVP architecture.

## Current Architecture
- Parent dashboard composes per-child event rows from team `games` docs.
- RSVP data lives under `games/{gameId}/rsvps`.
- Security model uses team owner/admin/parent relationships from `users` and `teams` docs.

## Proposed Architecture
- Add rideshare subcollection:
  - `teams/{teamId}/games/{gameId}/rideOffers/{offerId}`
  - `teams/{teamId}/games/{gameId}/rideOffers/{offerId}/requests/{requestId}`
- Keep all writes client-side through `js/db.js` helpers, enforcing seat count correctness with `runTransaction`.
- Parent dashboard reads rideshare offers per event and renders event-local blocks in list and day-modal views.

## Control Equivalence
- Access remains tenant-scoped by team ID.
- Parent request creation is constrained by linked child validation (`isParentForPlayer`).
- Request decision authority limited to driver or team owner/admin.
- No broadening of top-level document access.

## Blast Radius Comparison
- Before: RSVP only, no rideshare operations.
- After: additional reads/writes under event subcollections; no change to unrelated pages or data paths.

## Rollback Plan
- Revert rideshare UI blocks in `parent-dashboard.html`.
- Remove rideshare helpers in `js/db.js` and `js/rideshare-helpers.js`.
- Remove `rideOffers` rules section from `firestore.rules`.
