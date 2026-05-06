# QA Notes

Acceptance criteria: the bulk AI smoke harness must boot `edit-roster.html`, switch to the Bulk AI tab, show the roster image preview after upload, clear image state on cancel, and ensure the next text-only run does not reuse stale image input.

Validation run: `npx playwright test --config=playwright.smoke.config.js tests/smoke/edit-roster-bulk-ai-reset.spec.js --reporter=line`.

Expected result after fix: both affected smoke tests pass locally.
