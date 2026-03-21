Chosen thinking level: low
Reason: runtime footer links are already corrected; the missing control is enforceable smoke coverage plus CI wiring to execute it.

Implementation plan:
1. Add a new Playwright smoke spec for footer support links on `/` and `/login.html`.
2. Update smoke GitHub Actions workflows to run the smoke suite instead of a single spec file.
3. Run focused validation: unit tests plus the smoke suite against a local static server.

Fallback path:
- If `login.html` proves too unstable in smoke, switch the shared-footer coverage to another public shared-footer page that imports only `renderFooter(...)` reliably.
