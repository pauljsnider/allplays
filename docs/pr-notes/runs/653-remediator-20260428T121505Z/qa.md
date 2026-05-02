# QA Plan

Manual validation:

1. Team with `streamAccessMode = confirmed_members`, RSVP doc `${uid}__${playerId}` containing `{ userId: uid, response: "going" }`, signed in as that user, opens Game Day and gets limited stream access.
2. Legacy RSVP doc `{uid}` with `response: "going"` still grants limited stream access.
3. Override RSVP with `maybe` or `not_going` still redirects as unauthorized.
4. RSVP for a different `userId` does not grant access.
5. Owner/admin still receives full access.
