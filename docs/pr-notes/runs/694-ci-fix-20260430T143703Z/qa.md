# QA notes

Validation target: `tests/smoke/edit-roster-bulk-ai-reset.spec.js`, the failing preview-smoke area.

Expected behavior: uploading a roster image makes `#roster-image-preview` visible, cancel clears image/text draft state, and a fresh text-only run does not reuse stale image input.

Command run: `npx playwright test tests/smoke/edit-roster-bulk-ai-reset.spec.js --config=playwright.smoke.config.js --reporter=line` with a local static server on port 4173. Result: 2 passed.
