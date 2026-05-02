# Architecture

- Add an override-aware RSVP lookup in `js/db.js` that queries the game RSVP collection by `userId` and returns a confirmed response when present.
- Keep a legacy direct-document fallback for `/rsvps/{uid}` to preserve old data behavior.
- Use the helper from `game-day.html` only for `confirmed_members` mode.
- No data migration or Firestore rules change is required because RSVP reads already allow team admins/owners and team parents.
