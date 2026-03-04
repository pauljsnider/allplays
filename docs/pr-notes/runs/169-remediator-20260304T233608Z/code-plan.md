# Code role notes
- File `js/db.js`:
  - In `submitRsvpForPlayer`, after writing per-player doc, best-effort delete legacy doc id `effectiveUserId` when different from per-player doc id.
- File `js/parent-dashboard-rsvp.js`:
  - In `resolveMyRsvpByChildForGame`, when `extractRsvpPlayerIds(rsvp)` is empty for current user RSVP, fallback to current game scoped child IDs.
- Keep all other behavior unchanged.
