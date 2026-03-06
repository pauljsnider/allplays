# Architecture Role Notes

## Current State
`computeRsvpSummary()` always performs `getPlayers(teamId)` plus fallback profile reads for unresolved RSVPs.

## Proposed State
Introduce module-level team-scoped hydration cache:
- `rosterPromise` keyed by `teamId`
- `playerIdsByUserPromise` keyed by `teamId+userId`

## Risk / Blast Radius
- Blast radius limited to RSVP summary computation in `js/db.js`.
- Staleness risk is bounded to session-level UI reads and matches existing eventual consistency expectations.
- Error handling preserves retry by evicting failed promises.

## Control Equivalence
No security model change; same Firestore calls, fewer redundant calls.
