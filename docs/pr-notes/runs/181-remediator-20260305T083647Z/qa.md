# QA role (inline fallback)

- Regression target: ensure existing active-view update behavior remains unchanged.
- New checks:
  - retry denied while waiting for post-resume snapshot
  - retry allowed once snapshot is marked fresh and messages exist
- Validation: run `npx vitest tests/unit/team-chat-last-read.test.js` (or closest available local command).
