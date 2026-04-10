# Architecture Role

## Decision
Extract packet-row scoping into reusable helpers in `js/parent-dashboard-packets.js` and consume them from `parent-dashboard.html`.

## Why
- The defect is data-shaping, not transport or persistence.
- A shared pure helper keeps the fix reviewable and testable without introducing DOM-heavy tests.
- The blast radius stays narrow: row rendering and preview controls only.

## Control Equivalence
- No data model changes.
- No Firestore path changes.
- No auth or authorization changes.
- Completion writes continue to carry an explicit `childId`.

## Minimal Fix Shape
1. Add a helper that returns the visible child set for a packet row given the selected player id.
2. Add a helper that computes completed child ids and the scoped completion count.
3. Update packet card rendering to use the scoped data for:
   - `Packet Completed`
   - `Applies to`
   - visible completion buttons

## Rollback
Revert the helper usage in `parent-dashboard.html` and the associated helper additions in `js/parent-dashboard-packets.js`.
