Decision: keep strict child-scope enforcement in `resolveRsvpPlayerIdsForSubmission`, and add a calendar-specific wrapper for legacy no-scope submissions.

Why this shape:
- The base resolver is still the right control point for scoped parent submissions.
- Calendar pages still need compatibility with events that do not carry `childId` or `childIds`.
- A wrapper keeps the blast radius local to calendar RSVP wiring instead of weakening scope checks across the app.

Control comparison:
- Previous regression blast radius: all no-scope calendar users hit a blocking error on RSVP submission.
- Current blast radius: only calendar submission uses the fallback path, and only when there is no explicit selection and no scoped event metadata.

Rollback plan: revert the calendar wrapper callsite and helper if downstream RSVP documents show incorrect player scoping.
