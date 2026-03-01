# Code Role Summary

## Implemented Patch Set
1. Firestore rules hardening
- File: `firestore.rules`
- Added open-offer precondition to `rideOffers/{offerId}/requests` create rule.

2. Parent dashboard rideshare child selection correctness
- File: `parent-dashboard.html`
- Added `selectedRideChildBySelector` map and `setRideChildSelection` handler.
- Recomputed `myRequest`, `canRequest`, and selected child labels from active selection.
- Wired child `<select>` `onchange` to rerender modal and refresh controls.

## Why this minimal patch
- Preserves existing helper APIs and transactional seat-count semantics.
- Avoids broader UI refactor while directly closing reported failure modes.
