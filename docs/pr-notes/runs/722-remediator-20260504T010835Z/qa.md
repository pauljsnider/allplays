# QA Plan

- Static check `js/db.js` to confirm `reorderRosterFieldDefinitions` uses `batch.set` with merge semantics, not `batch.update`.
- Static check `js/db.js` for absence of `store.add(updatedField)`/`store.add` insert-only IndexedDB update paths.
- No automated runner is defined for this static-site repo; use focused source inspection for this minimal review remediation.
