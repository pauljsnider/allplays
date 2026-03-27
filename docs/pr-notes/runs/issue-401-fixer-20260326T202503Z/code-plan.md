## Thinking Level

medium: one-page behavior change with clear evidence of a routing defect and low blast radius.

## Plan

1. Add a focused unit test file for Game Day entry routing and URL normalization.
2. Confirm the test fails against current code.
3. Extract the selection logic into a small helper module and wire `game-day.html` to it.
4. Re-run the targeted tests and then the broader unit suite.
5. Commit the targeted fix and tests for issue #401.
