# Code Plan

- Change `reorderRosterFieldDefinitions` to upsert each roster field document with `batch.set(docRef, payload, { merge: true })`.
- Add `key: fieldId` to the reorder payload so a missing legacy field document is useful after creation.
- Verify there is no remaining insert-only `store.add` update call in `js/db.js`.
