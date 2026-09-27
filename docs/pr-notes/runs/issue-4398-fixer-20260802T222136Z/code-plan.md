# Code plan

Bound to starting SHA `98bea9bf5428a41ad056c1c147ba8fddc5a6eb34`.

Preserve all #4397 exports and add `createFriendInviteRedemptionTransaction({ firestore, Timestamp, HttpsError, logger })`. The returned operation accepts only `{ code, recipientIdentities }`; it never reads raw callable auth or request identity fields.

Implementation order:

1. Add private normalization, timestamp, pair-ID, active-invite, target-match, existing-friendship, shared-team, and accepted-payload helpers.
2. Use a private rejection sentinel with bounded reason enums.
3. Read invite, friendship, and recipient profile before staging exactly two writes.
4. Catch every rejection and Firestore failure at the exported boundary and return the existing generic `permission-denied` error.
5. Extend the adjacent Node test file with the deterministic transaction harness and acceptance matrix before implementation.

Avoid the historical broad implementation's callable registration, `functions/index.js` edits, emulator coverage, raw context/data input, changed error text, weakened Auth phone normalization, UID trimming, and repair of malformed friendships. Those belong outside #4398 or would weaken #4397's boundary.
