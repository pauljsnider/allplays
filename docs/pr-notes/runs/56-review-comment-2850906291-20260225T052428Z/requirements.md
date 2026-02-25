# Requirements Role Summary

## Objective
Prevent direct ride-offer updates from increasing or decreasing `seatCountConfirmed` by more than one seat per write.

## Current State
`rideOffers` update rules enforce numeric bounds (`>= 0` and `<= seatCapacity`) but permit multi-seat jumps in a single write.

## Proposed State
A single write can only change `seatCountConfirmed` by at most 1, reducing abuse window if a client bypasses transactional helpers.

## Risk Surface and Blast Radius
- Affects only `/teams/{teamId}/games/{gameId}/rideOffers/{offerId}` updates.
- Does not alter request-level transactional flow; blocks only oversized seat jumps.
- Parent/driver/admin UX impact: sequential seat adjustments required for manual corrections larger than one.

## Assumptions
- Legitimate seat-count changes occur through request status updates.
- Direct ride-offer updates to seat counters are exceptional and should be constrained.

## Recommendation
Add `math.abs(request.resource.data.seatCountConfirmed - resource.data.seatCountConfirmed) <= 1` to `rideOffers` update guard.

## Success Criteria
- Direct update attempts with seat count delta > 1 are denied by rules.
- Existing transaction-driven confirm/decline operations remain allowed.
