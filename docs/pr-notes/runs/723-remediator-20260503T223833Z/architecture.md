# Architecture

- `team.html` gates `getRsvpSummaries`, `getRsvps`, and `getMyRsvp` hydration behind RSVP read eligibility that mirrors current Firestore rules.
- Visitors without RSVP read access continue to render denormalized `game.rsvpSummary` from the public game document.
- `getMyRsvp` accepts optional linked player IDs, reads matching `uid__playerId` override docs, and returns a consistent response or `mixed` when child responses differ.
- Rollback is reverting `team.html` and `js/db.js`.
