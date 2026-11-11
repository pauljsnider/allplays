# Architecture analysis

> Main-lane synthesis: the requested allplays-architecture-expert skill was unavailable and the required subagent runtime failed before producing output.

- Keep RSVP interpretation in AssignmentsSection, which owns the selected event.
- Normalize event.myRsvp through the existing schedule helper.
- Represent readiness as ready for Going and attendance-follow-up for every other RSVP.
- Pass the state into AssignmentCard and expose it on the existing Sign up control.
- Do not change services, Firestore rules, claim/release handlers, or admin predicates.

## Recurrence risk

Low after focused coverage: the Going state and service call become explicit, while release remains demonstrably RSVP-independent.
