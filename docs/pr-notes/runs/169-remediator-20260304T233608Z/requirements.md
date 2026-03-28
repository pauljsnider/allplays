# Requirements role notes
- Objective: Remediate PR #169 unresolved review feedback threads PRRT_kwDOQe-T585yMHyI and PRRT_kwDOQe-T585yMHyJ.
- Required behavior 1: When saving per-player RSVP (`rsvps/{uid__playerId}`), avoid coexistence with legacy parent-level doc `rsvps/{uid}` for same game/user to prevent duplicate counting in RSVP summary aggregation.
- Required behavior 2: Hydration of parent dashboard RSVP state must continue to support legacy RSVP docs that have no `playerIds`, `playerId`, or `childId` fields.
- Scope constraints: minimal targeted change in RSVP write and hydration resolution paths only.
