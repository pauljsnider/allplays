Recommendation: keep the fix at the page and rideshare-helper boundary.

Design:
- Bump the `utils.js` query token on pages that import the new calendar tracking exports.
- Preserve the parent dashboard UI key as the occurrence id so recurring events stay distinct in the schedule.
- Carry the original ICS `uid` alongside the occurrence id for recurring ICS events.
- Extend rideshare loading/creation helpers with a fallback candidate list so legacy UID-backed offers remain reachable.
- When offers are loaded from a legacy path, propagate the source game id with each offer so follow-up mutations hit the correct Firestore path.

Blast radius:
- Limited to `edit-schedule.html`, `parent-dashboard.html`, and rideshare functions in `js/db.js`.
- No Firestore schema or rules changes.
