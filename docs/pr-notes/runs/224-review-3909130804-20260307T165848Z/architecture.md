# Architecture Role Summary

Thinking level: medium

## Decision
Preserve the current per-user subcollection model and add control equivalence at the document level instead of redesigning storage.

## Why
- Smallest viable change for this PR.
- Keeps blast radius local to the incentives feature.
- Enforces least privilege using existing `parentPlayerKeys` without introducing a new backend service.

## Design Notes
- Firestore rules should validate `teamId` and `playerId` on both `resource.data` and `request.resource.data`.
- Cap documents need the same identity fields as rules and payment records so rules can reason about them safely.
- Client-side escaping belongs at the HTML insertion boundary, not in the formatter API.
- Firestore read helpers should log and rethrow; UI should own the fallback presentation.

## Tradeoffs
- Existing cap docs without `teamId` would no longer satisfy the stricter rule model. This is acceptable here because the feature is still in PR scope and not yet deployed broadly.
