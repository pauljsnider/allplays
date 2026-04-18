## QA Plan
1. Verify the Windows-path fix is the only required unit-test change.
2. Keep unit coverage focused on two acceptance criteria:
   - `help.html` exposes the `help-page-reference.html` entry point.
   - Every `.html` file listed in `help-page-reference.html` exists in the repo.
3. Retain one smoke check for end-to-end discoverability.
4. Call out one remaining coverage gap: production smoke should not rely on `response.ok()` alone for page-file validation because Firebase rewrites can return `index.html` with HTTP 200 for missing pages.

## Coverage Matrix
| Surface | Acceptance criterion | Guardrail | Gap/Note |
|---|---|---|---|
| `tests/unit/help-page-reference-integrity.test.js` path setup | Test can read repo files on Windows and POSIX | `fileURLToPath(import.meta.url)` + `dirname` + `resolve` | This is the review item |
| `help.html` | Help Center exposes file-by-file reference link | Unit assertion for href + link text | Good minimal coverage |
| `help-page-reference.html` | Listed `.html` files are shipped files | Unit regex extraction + `existsSync` loop | Regex is markup-sensitive, but acceptable as a lightweight guardrail |
| `tests/smoke/help-center.spec.js` navigation | User can reach reference page and return | Playwright navigation assertions | Good UX coverage |
| `tests/smoke/help-center.spec.js` file resolution | Referenced pages actually load | `request.get(...).ok()` loop | Weak in prod because rewrite fallback can still return 200 |

## Failure Modes To Catch
- Windows resolves `new URL(...).pathname` as `/C:/...`, causing false file-missing failures.
- A referenced page is renamed or deleted, but `help-page-reference.html` is not updated.
- The Help Center link to `help-page-reference.html` is removed or renamed.
- Firebase hosting rewrite returns `index.html` with 200, masking a missing target page in smoke.
- Table markup changes break the unit-test extractor even though the page still renders.

## Recommended Validation Commands
```bash
npx vitest run tests/unit/help-page-reference-integrity.test.js
npx vitest run tests/unit/help-center.test.js tests/unit/help-page-reference-integrity.test.js
python3 -m http.server 4173
SMOKE_BASE_URL=http://127.0.0.1:4173 npx playwright test tests/smoke/help-center.spec.js --config=playwright.smoke.config.js --reporter=line
```
