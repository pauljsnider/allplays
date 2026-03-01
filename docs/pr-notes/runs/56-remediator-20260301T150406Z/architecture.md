# Architecture role (fallback inline)

Current state:
- Seat accounting relies on client transaction helpers plus rules that validate offer/request coupling.
- Offer status lifecycle exists (`open|closed|cancelled`) but must be enforced on server-side request creation.
- Parent modal includes child picker, but eligibility rendering is tied to default child on first pass.

Proposed minimal state:
- Keep existing helper structure in `firestore.rules`; tighten predicates only.
- Keep parent-dashboard rendering flow; introduce per-offer selected child resolution helper and use it for `myRequest`/`canRequest` and child name derivation.

Blast radius:
- Firestore rules on rideshare paths only.
- Parent dashboard rideshare component only.
