# Architecture Role (manual fallback)

Required allplays orchestration skills/subagent tooling were requested but are unavailable in this runtime, so this is a manual role synthesis artifact.

## Current state
`submitGameRsvpFromButton` forwards `childId/childIds` from button dataset.
Resolver trusts explicit `childIds` when provided.

## Proposed state
Pass currently selected player-filter value as explicit `selectedChildId` context and prioritize it during RSVP playerId resolution.

## Why minimal and safe
- Touches only parent-dashboard RSVP context wiring + resolver precedence.
- Keeps existing allowed-scope sanitization against teamId+gameId.
- No Firestore schema or backend contract changes.

## Controls and blast radius
- Limits writes to least-privileged child scope when filter is present.
- Reduces over-scoped write blast radius for multi-child parents.
