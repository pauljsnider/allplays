Chosen thinking level: medium
Reason: single-flow bug in a large inline page script; needs a narrow fix plus regression coverage.

Implementation plan:
1. Add a unit test that executes the cancel-game click handler from source with mocked dependencies.
2. Patch the handler so cancellation success is not reversed by chat notification failure.
3. Validate with the focused unit test and the full unit suite.

Rollback plan:
- Revert the single commit if the updated handler causes schedule cancellation regressions.
