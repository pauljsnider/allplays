# Architecture role

## Current vs proposed
- Current: admin recipient derivation uses Firestore `users.email` query.
- Proposed: resolve admin recipients via Firebase Auth `getUserByEmail` and use returned UIDs.

## Risk and blast radius
- Risk reduced: removes authorization bypass caused by mutable profile email field.
- Blast radius: functions-only (`functions/index.js`); no Firestore schema changes.

## Design decisions
- Keep owner + parent UID sources unchanged.
- Keep notification preference and token storage model unchanged.
- Batch multicast sends in-process at 500-token chunks; aggregate response counts.
- Preserve existing deep-link routing behavior.
