Objective: add coverage without introducing a second implementation of statsheet persistence.

Current state:
- The apply handler lives inline in `track-statsheet.html`.
- Browser mocking is feasible, but persistence assertions are cleaner if the write-plan logic is isolated from DOM concerns.

Proposed state:
- Move validation and save-plan construction into `js/track-statsheet-apply.js`.
- Keep page orchestration in `track-statsheet.html`: upload, overwrite prompt, deletes, batch creation, summary reveal.
- Use Playwright module routing to mock `auth`, `db`, `firebase`, and AI responses while preserving the page’s real UI behavior.

Controls and blast radius:
- No schema changes.
- No auth model changes.
- The only production behavior change should be code organization plus any small correctness fixes found during test implementation.

Tradeoffs:
- Playwright-only assertions would work but would duplicate persistence expectations in the test.
- A helper seam adds one module, but it centralizes the write shape and reduces future drift between UI and test expectations.

Rollback:
- Revert the helper import and new smoke spec.
- No data migration or environment rollback is required.
