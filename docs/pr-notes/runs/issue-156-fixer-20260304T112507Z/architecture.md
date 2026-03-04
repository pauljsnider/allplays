# Architecture Role Synthesis (Fallback)

## Objective
Fix summary semantics with minimal blast radius in static web + Firebase client module.

## Design
- Introduce a pure helper to compute effective per-player RSVP summary from:
  - RSVP docs
  - active roster IDs
  - existing player-resolution fallback map
  - existing response normalization
- Reuse this helper in all summary paths:
  - `computeRsvpSummary`
  - `getRsvpSummaries`
  - `submitRsvpForPlayer` denormalized write

## Risk Surface
- Area: RSVP aggregation only.
- Blast radius: summary counts in parent/coaching calendar and game docs.
- Data model unchanged.

## Controls and Rollback
- No schema migration.
- Rollback is single commit revert.
- Unit tests isolate expected effective-per-player counting behavior.
