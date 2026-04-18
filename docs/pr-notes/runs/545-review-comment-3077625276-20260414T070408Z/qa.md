## QA Plan
1. Keep the Windows-path fix localized to `tests/unit/help-page-reference-integrity.test.js`.
2. Preserve regression coverage around:
   - the Help Center entry point to `help-page-reference.html`
   - existence of every `.html` file listed in `help-page-reference.html`
3. Preserve end-to-end smoke coverage proving users can open the file reference page and navigate back.
4. Prefer the current `fileURLToPath` approach over a regex workaround.

## Coverage Matrix
| Surface | Acceptance criterion | Guardrail | Note |
|---|---|---|---|
| `tests/unit/help-page-reference-integrity.test.js` path setup | Test resolves repo files on Windows and POSIX | `fileURLToPath(import.meta.url)` + `dirname` + `resolve` | Review item |
| `help.html` | Help Center shows the page-reference entry point | Assert href and visible link text | Minimal user-facing guardrail |
| `help-page-reference.html` | Listed `.html` pages are actually shipped | Extract file rows and `existsSync` each file | Lightweight stale-link protection |
| `tests/smoke/help-center.spec.js` navigation | User can open page reference, return, and open a workflow | Playwright navigation assertions | Discoverability coverage |

## Failure Modes To Catch
- Windows turns `new URL(...).pathname` into `/C:/...`, causing false missing-file failures.
- A referenced `.html` page is renamed or deleted without updating `help-page-reference.html`.
- The Help Center link to `help-page-reference.html` disappears.
- Table markup changes break the regex extractor.

## Recommended Validation Commands
```bash
npx vitest run tests/unit/help-page-reference-integrity.test.js
npx vitest run tests/unit/help-center.test.js tests/unit/help-page-reference-integrity.test.js
SMOKE_BASE_URL=http://127.0.0.1:4173 npx playwright test tests/smoke/help-center.spec.js --config=playwright.smoke.config.js --reporter=line
```
