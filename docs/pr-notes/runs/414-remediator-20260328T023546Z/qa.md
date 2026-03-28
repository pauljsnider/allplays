Validation plan:
- Confirm the spec now mocks every module imported by `edit-config.html` that the test depends on.
- Run the repo unit test command (`npm test`) to check for unrelated regressions in the local environment.
- If Playwright is available, the ideal extra check is the targeted smoke spec for `edit-config-platform-admin.spec.js`.

Known limitation:
- `AGENTS.md` and `CLAUDE.md` do not define a smoke-test runner for this repo, and Playwright is not declared in `package.json`.
