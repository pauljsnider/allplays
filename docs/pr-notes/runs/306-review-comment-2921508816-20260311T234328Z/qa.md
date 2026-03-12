# QA Role

- Focus area: publish-lineup regression around partial success handling.
- Primary scenario:
  - persist lineup succeeds
  - team chat notification fails
  - UI still shows publish success state
  - coach receives explicit alert to notify the team manually
- Guardrails:
  - draft-save flow should remain unchanged
  - publish versioning and baseline comparison should still use persisted game-plan state
  - no regression in the post-persist notification sequencing
- Validation approach:
  - run focused unit coverage for `tests/unit/game-day-lineup-publish.test.js`
  - assert source wiring still contains `afterPersist`, persisted baseline usage, and the new user-facing alert copy
- Residual gap:
  - no browser-level manual check executed in this run, so alert rendering is validated via source-based unit coverage rather than end-to-end interaction
