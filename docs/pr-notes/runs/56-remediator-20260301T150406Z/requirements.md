# Requirements role (fallback inline)

Objective: remediate unresolved PR #56 review threads with minimal scoped changes.

Required fixes:
1. Firestore rule hardening for ride offers: limit `seatCountConfirmed` mutation per offer update to at most +/-1.
2. Firestore request create rule must only allow new requests when referenced offer status is `open`.
3. Firestore request owner updates must not allow status resets (especially `confirmed -> pending`) that bypass transactional seat accounting.
4. Parent dashboard modal rideshare UI must compute request/can-request from the selected child in picker flow.

Acceptance:
- Rules reject direct writes that bypass lifecycle constraints.
- Modal request/cancel controls reflect currently selected child.
- No unrelated refactors.
