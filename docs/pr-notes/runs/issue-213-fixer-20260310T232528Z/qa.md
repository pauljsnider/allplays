Test focus:
- Fail first on shared schedule helper coverage for linked tournament fixtures.
- Verify mirrored payload contains tournament metadata and that nested objects are cloned.
- Re-run existing shared schedule and tournament helper tests to guard against regressions.

Manual risk notes:
- This patch does not add organization CRUD, membership, or CSV import.
- It narrows the feature gap by fixing a real synchronization hole in the existing linked-team workflow.
