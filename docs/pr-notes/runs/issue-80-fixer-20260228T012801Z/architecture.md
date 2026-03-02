# Architecture Role (fallback in-process synthesis)

## Root cause
`submitRsvp` suppresses `not-found` when updating `games/{gameId}.rsvpSummary` for virtual recurring IDs, so summary is often not persisted. Initial page hydration in Calendar/Parent Dashboard reads only `getMyRsvp`, leaving `rsvpSummary` null on reload.

## Proposed change
1. Add `getRsvpSummary(teamId, gameId)` in `js/db.js` that recomputes summary from `rsvps` + active roster using existing normalization logic.
2. In Calendar and Parent Dashboard initial hydration, fetch both `myRsvp` and computed summary per unique event key and apply summary when present.

## Risk and blast radius
- Affects RSVP display only; no write-path schema changes.
- Additional read load during page init, bounded by number of displayed tracked events.
