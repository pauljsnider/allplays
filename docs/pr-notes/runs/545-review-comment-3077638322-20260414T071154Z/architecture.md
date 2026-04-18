## Architecture Decisions
- Treat Help Center smoke as a file-identity check, not just an HTTP availability check.
- Because `firebase.json` rewrites `**` to `/index.html`, production smoke must verify each requested `*.html` returns its own page content, not the SPA fallback.
- For this static-site repo, the smallest reliable signal is a server-returned HTML invariant available without app JS bootstrapping. Comparing the served `<title>` to the source file’s `<title>` is a good fit.
- Keep the per-file loop at the HTTP layer with `request.get(...)` to stay faster and less flaky than opening every page in a browser tab.

## Constraints
- Static HTML app, no build step.
- Production smoke runs against `https://allplays.ai`.
- Firebase Hosting catch-all rewrite means missing pages can still return `200 OK`.
- The test must stay reliable on CI and local environments.

## Minimal Safe Change
- In `tests/smoke/help-center.spec.js`, keep the existing loop over workflow and reference files.
- Strengthen the helper so it:
  1. asserts `response.ok()`
  2. reads the response HTML
  3. reads the expected source HTML from the repo
  4. compares a stable identity marker, preferably `<title>`, between source and response.
- Do not change `help.html`, `help-page-reference.html`, or Firebase routing for this review item.

## Risks And Rollback
- Title-based identity is weaker if multiple pages intentionally share titles.
- Reading source files in test code couples the smoke test to the repo, which is acceptable for deploy integrity on known static files.
- Rollback would be limited to the identity-comparison helper, but that would reopen the production blind spot.
