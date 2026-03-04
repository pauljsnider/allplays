# Architecture Role Synthesis

## Decision
Implement a small predicate-based change in `parent-dashboard.html` only.

## Current vs Proposed
- Current rideshare eligibility: `event.isDbGame && !event.isCancelled && teamId && id`.
- Proposed rideshare eligibility: `(event.isDbGame || event.type === 'practice') && !event.isCancelled && teamId && id`.

## Design Notes
- Keep storage contract unchanged (`gameId` parameter remains event ID token).
- Update hydration filter to prefetch offers for eligible practice events.
- Avoid touching `js/db.js` to minimize blast radius.

## Control Equivalence
- Authz/rules remain identical; no new write paths introduced.
- Existing validation and seat-count integrity remain in Firestore rules and db helpers.

## Rollback Plan
Revert parent-dashboard predicate/hydration filter changes.
