# Requirements

- Reordering roster field definitions must succeed for both subcollection-backed fields and legacy team-level fields returned by `getRosterFieldDefinitions`.
- Updating an existing local roster field record must not use an insert-only IndexedDB API. Current `js/db.js` has no `store.add(updatedField)`/`store.add` path to change, so the active code already avoids that failure mode.
- Changes must stay scoped to PR review feedback in `js/db.js`.
