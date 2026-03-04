# Architecture role notes
- Data-model compatibility: system currently has two RSVP doc shapes: legacy parent-level by `uid` and per-player by `uid__playerId`.
- Failure mode 1: counting logic aggregates per-document player IDs, so coexistence of both shapes for same parent/game can double count.
- Chosen fix: in per-player submit path, delete legacy parent-level `rsvps/{uid}` after writing `rsvps/{uid__playerId}`.
- Failure mode 2: hydration resolver only trusts explicit child IDs on doc; legacy docs with no IDs become invisible.
- Chosen fix: resolver falls back to scoped child IDs for the current parent/game when a matching user RSVP lacks explicit IDs.
- Blast radius: confined to RSVP write path and parent dashboard hydration utility.
