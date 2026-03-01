# Requirements Role Summary

## Objective
Close PR #56 review gaps while preserving parent usability and rideshare lifecycle integrity.

## Current State
- Parents can create ride requests without rules-level check that the offer is still `open`.
- In modal rideshare UI for multi-child parents, request/cancel controls are computed from default child, not selected child.

## Proposed State
- Rules require offer status `open` on request creation.
- Modal controls recompute from selected child so availability/action state matches user intent.

## Risk Surface and Blast Radius
- Firestore rules change affects only `teams/{teamId}/games/{gameId}/rideOffers/{offerId}/requests` create path.
- UI state change affects rideshare rendering in `parent-dashboard.html` modal context only.

## Assumptions
- Offer lifecycle should block new demand after `closed`/`cancelled`.
- Parent can still cancel their existing request through transactional API flow.

## Success Criteria
- Direct writes to create requests fail when offer is not `open`.
- In day modal, selecting different child updates Request/Cancel controls immediately.
