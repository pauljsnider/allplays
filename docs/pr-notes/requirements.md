# Requirements Role Notes (Issue #53 Rideshare)

## Objective
Ship an MVP rideshare workflow on `parent-dashboard.html` so parents can offer seats and request spots for scheduled games/practices.

## Current State
- Parent dashboard supports availability (RSVP), attendance, and take-home packets.
- No rideshare data model, no rideshare UI, and no permissions for rideshare documents.

## Proposed State
- Add event-level rideshare offers + nested requests under each `teams/{teamId}/games/{gameId}` event.
- Surface rideshare controls on parent schedule list cards and day modal.
- Allow parent drivers to manage request decisions with transaction-protected seat counts.

## Acceptance Mapping
- Parent creates offer: `createRideOffer` + dashboard offer form.
- Another parent requests for linked child: `requestRideSpot` + request actions.
- Driver confirms and seat counts update: `updateRideRequestStatus` transaction updates `seatCountConfirmed`.
- Cannot exceed seat capacity: transaction throws if confirm would overbook.
- Parent-child linkage enforced: Firestore rules require `isParentForPlayer(teamId, childId)` for request create.
- Dashboard reflects state in-page: refresh rideshare for event + rerender without navigation.

## Assumptions
- MVP scopes rideshare to Firestore-tracked DB events (`isDbGame=true`), not external ICS-only events.
- A request ID is unique per parent+child per offer (`{parentUid}__{childId}`).
- Offer owner (driver) is the primary manager; team owner/admin can also moderate via rules.

## Risk Surface / Blast Radius
- `parent-dashboard.html` (UI + interactions)
- `js/db.js` (new Firestore helpers and transactions)
- `firestore.rules` (new write/read paths)
- New helper module + tests only (`js/rideshare-helpers.js`, `tests/unit/rideshare-helpers.test.js`)

## Recommendation
Ship this as a contained parent-dashboard MVP with strict rules and transaction checks now; defer notifications/recurring-series rideshare to follow-up issues.
