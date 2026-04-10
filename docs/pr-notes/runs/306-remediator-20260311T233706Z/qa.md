Validation plan:
- Run the existing unit test file covering lineup publish helpers.
- Add assertions for the new wiring guarantees:
  - publish notification happens after persistence wiring exists
  - partial-success notification failure is surfaced to the user
  - persisted game-plan baseline is sourced from live game state

Residual risk:
- This is still page-level wiring tested mostly via source assertions, so runtime browser verification remains advisable in the PR flow.
