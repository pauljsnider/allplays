Implementation steps:
1. Update `tests/smoke/edit-config-platform-admin.spec.js`.
2. Add a stub constant for `edit-config-access.js?v=1`.
3. Register a new `page.route` in `mockDependencies(page)` for that module.
4. Run available validation commands.
5. Stage and commit only the scoped changes.
