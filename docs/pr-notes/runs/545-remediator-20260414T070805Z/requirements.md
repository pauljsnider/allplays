# Requirements

## Acceptance Criteria
- `tests/unit/help-page-reference-integrity.test.js` derives `REPO_ROOT` in a way that works on Windows paths and still resolves repo files on Unix-like systems.
- `tests/smoke/help-center.spec.js` fails when a requested `*.html` file is silently rewritten to `/index.html`, even if the HTTP status is 200.
- Changes stay scoped to the two review comments only.

## Requirement Risks
- A status-only smoke assertion can pass against Firebase Hosting SPA rewrites and miss missing help files in production.
- URL pathname handling can prepend `/` to Windows drive-letter paths and break filesystem reads in unit tests.

## Recommendation
- Apply the smallest possible repo-root fix in the unit test.
- Strengthen the smoke assertion by comparing each fetched page response against the deployed `/index.html` fallback body so missing pages cannot pass via rewrite behavior.
