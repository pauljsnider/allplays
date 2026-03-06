# Architecture role (manual fallback)

- Current state: `resolveRsvpPlayerIdsForSubmission` returns `[]` for ambiguous/invalid scope, and `submitGameRsvp` still writes RSVP docs.
- Proposed state: resolver throws on unresolved scope so submit path is interrupted before any DB write.
- Blast radius: parent dashboard RSVP path only; no schema changes.
