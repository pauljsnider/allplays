# Code Plan

1. In `team.html`, compute RSVP read eligibility before summary, note, and current RSVP hydration.
2. Pass linked player IDs into `getMyRsvp` when hydrating team schedule events.
3. In `js/db.js`, extend `getMyRsvp` to resolve per-player override docs and mixed child responses while preserving existing callers.
