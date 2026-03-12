Decision: fix the existing shared-schedule mirror payload instead of introducing a new organization domain in this patch.

Why:
- Lowest blast radius. The defect is localized to `js/shared-schedule-sync.js`.
- Matches the current Firestore model. Each team still owns its own `teams/{teamId}/games/{gameId}` doc.
- Improves the part of issue #213 the product can already support today: synced linked-team tournament fixtures.

Design:
- Extend the pure mirrored payload builder to clone nested tournament metadata into mirrored fixtures.
- Keep the mirror contract symmetric so edits continue to sync through the existing `js/db.js` flow.

Risk surface:
- Limited to linked shared-game payload generation.
- Main risk is mutating nested tournament objects across source and mirror, so regression coverage should assert cloning semantics.
