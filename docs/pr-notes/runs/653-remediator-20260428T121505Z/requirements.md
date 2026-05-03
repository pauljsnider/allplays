# Requirements

- In `confirmed_members` stream access mode, a signed-in user must be granted limited stream access when any RSVP owned by that user for the game is confirmed.
- Ownership must be based on `userId === currentUser.uid` for collection query results.
- Legacy `/rsvps/{uid}` documents must continue to work, including older docs missing `userId` when the doc ID is the authenticated UID.
- Non-confirmed responses must continue to deny stream access.
- Full-access users remain unaffected.
