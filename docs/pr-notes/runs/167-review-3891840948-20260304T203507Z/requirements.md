# Requirements Role Notes

## Objective
Prevent rideshare offer writes when parent-team access synchronization fails.

## User-facing constraint
Parents should either (a) successfully create a rideshare offer, or (b) receive a clear error without partial write attempts.

## Acceptance criteria
- `submitRideOfferFromForm` must block `createRideOffer` if `ensureParentTeamAccess` fails.
- Access-sync failures in this path must propagate into existing UI error handling.
- Existing non-critical uses of `ensureParentTeamAccess` can retain non-blocking behavior.

## Risk and blast radius
- Scope limited to parent dashboard pre-write gate for rideshare offers.
- No backend contract changes; no firestore rule changes.
