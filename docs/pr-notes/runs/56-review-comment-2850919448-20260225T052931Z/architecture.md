# Architecture Role

## Objective
Make lifecycle enforcement explicit in Firestore rules with minimal change.

## Current vs Proposed
- Current state: inline `get(...).data.status == 'open'` in request create rule.
- Proposed state: `isRideshareOfferOpen(teamId, gameId, offerId)` helper (`exists + status`) used by request create rule.

## Risk Surface / Blast Radius
- Security boundary: Firestore rules only.
- Blast radius: one helper + one call-site replacement, no schema change.

## Assumptions
- Rules evaluation cost remains acceptable for one additional helper call.
- Existing write paths already provide required fields.

## Recommendation
Adopt helper-based guard for consistency with existing rideshare helper pattern (`rideshareOfferPath`, seat-count validator). Tradeoff: negligible complexity for clearer policy semantics.

## Rollback
Revert helper and call-site if regression appears; no data migration required.
