# Requirements role (manual fallback)

- Orchestration skills/sessions_spawn unavailable in this runtime, so analysis is inline.
- Review thread requires preventing ambiguous parent RSVP submissions from persisting `playerIds: []`.
- Success criteria: parent dashboard RSVP must not call `submitRsvp` when child scope cannot be resolved to at least one in-game child ID.
