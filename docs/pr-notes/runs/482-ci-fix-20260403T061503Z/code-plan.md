# Code Role Notes

1. Keep the shared-game delete protection in `js/db.js` unchanged.
2. Update `tests/unit/edit-config-delete-guard.test.js` to assert the new combined guard condition.
3. Bump `edit-config.html` to `./js/db.js?v=16` so the cache-bust guard sees a matching import update.
4. Update the related smoke test route stub to `v=16`.
5. Run targeted validation, then stage and commit only the scoped CI-fix files.
