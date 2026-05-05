# Requirements

- Public and unrelated signed-in visitors must not trigger RSVP subcollection reads from `team.html`; they should use the denormalized `game.rsvpSummary` available through public game reads.
- Team users who can read RSVP docs under Firestore rules, namely full team access users and parents, may hydrate live RSVP summaries and note rows.
- Current-user RSVP state on the team schedule must consider per-player override RSVP docs (`uid__playerId`) for the user linked players, not only the legacy aggregate `uid` RSVP doc.
- Mixed per-player responses must not be collapsed into an aggregate action that can overwrite child-specific availability.
