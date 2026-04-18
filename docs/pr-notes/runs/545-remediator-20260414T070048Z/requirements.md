# Acceptance Criteria
- `tests/unit/help-page-reference-integrity.test.js` resolves `REPO_ROOT` from `import.meta.url` in a way that works on Windows and POSIX, so repo file reads and `existsSync` checks do not fail on Windows path formats.
- `tests/smoke/help-center.spec.js` continues verifying every help-manifest and page-reference file returns HTTP success.
- The smoke test also detects Firebase Hosting SPA rewrite fallbacks by proving each requested HTML file returns its own document content, not `/index.html`.

# Non-Goals
- No changes to production HTML pages or Firebase rewrites.
- No broad refactor of test helpers or unrelated smoke coverage.

# Risks/Edge Cases
- Comparing requested pages against `/index.html` assumes no listed help file is intentionally identical to the home page, which is a safe assumption for this repo.
- The content check should stay generic enough to work across all help and workflow pages without hard-coding every page title.
