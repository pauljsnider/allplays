# Requirements Role

## Objective
Prevent parents from creating new ride requests once an offer is no longer open.

## Current vs Proposed
- Current state: Request create authorization depended on identity/link checks and an inline offer status read.
- Proposed state: Request create authorization uses an explicit helper that requires offer existence and `open` status.

## Risk Surface / Blast Radius
- Risk addressed: direct Firestore writes bypassing UI guard and reopening demand on closed/cancelled offers.
- Blast radius: limited to `rideOffers/{offerId}/requests` creation; no user-flow expansion.

## Assumptions
- Offer lifecycle is authoritative in Firestore (`open`, `closed`, `cancelled`).
- Parent UX should block new demand unless offer is open.

## Recommendation
Ship explicit server-side offer-open gate for request creation. Tradeoff: one extra helper indirection, but stronger lifecycle clarity and reviewability.

## Success Metrics
- New request writes fail when offer status is `closed` or `cancelled`.
- Existing pending/decision flows remain unchanged.
