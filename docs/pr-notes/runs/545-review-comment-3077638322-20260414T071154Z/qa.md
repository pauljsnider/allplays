## QA Plan
- Keep the existing unit guardrails that ensure the page-reference link remains discoverable and every referenced `.html` file exists in the repo.
- Preserve the Help Center smoke UX flow for load, filtering, page-reference navigation, and workflow navigation.
- Treat hosted rewrite masking as the primary regression risk.
- Keep `response.ok()` plus source-vs-response title matching for every referenced file as the minimal guardrail for this PR.

## Coverage Matrix
| Surface | What it guards | Current strength | Gap |
|---|---|---:|---|
| `tests/unit/help-page-reference-integrity.test.js` | Listed pages are real shipped files | Strong | Markup regex is somewhat brittle |
| `help.html` link assertion | Reference page is discoverable | Strong | None for this PR |
| `tests/smoke/help-center.spec.js` navigation flow | Help Center and page-reference UX still work | Strong | None material |
| `expectRequestedPageResponse()` | Missing page should not pass via Firebase 200 rewrite | Good minimal guard | Relies on distinct page titles |
| `firebase.json` catch-all rewrite | Real production risk source | High-risk surface | Needs content-aware assertion, not status alone |

## Failure Modes To Catch
- A referenced file is deleted or renamed, but `help-page-reference.html` still lists it.
- Firebase serves `/index.html` for a missing page with HTTP 200.
- A referenced page serves the wrong HTML document but still returns OK.
- A future refactor removes the title comparison and falls back to `response.ok()` only.

## Recommended Validation Commands
```bash
npx vitest run tests/unit/help-page-reference-integrity.test.js tests/unit/help-center.test.js
python3 -m http.server 4173
SMOKE_BASE_URL=http://127.0.0.1:4173 npx playwright test tests/smoke/help-center.spec.js --config=playwright.smoke.config.js --reporter=line
```
