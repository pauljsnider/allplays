# Code Role Plan (Fallback)

## Plan
1. Add pure helper module for effective per-player RSVP summary.
2. Add failing unit tests capturing parent+coach overlap bug.
3. Wire helper into existing summary paths in `js/db.js`.
4. Run targeted and related RSVP unit tests.
5. Commit with issue reference.

## Assumptions
- `respondedAt` ordering determines latest effective response.
- Existing player ID resolution and fallback behavior remains authoritative.
- No backend/cloud function changes required.
