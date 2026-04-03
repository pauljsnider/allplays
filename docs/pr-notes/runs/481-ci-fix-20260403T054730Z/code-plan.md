Root cause:
- `seedScenario()` navigated to `about:blank` and then wrote `localStorage`.
- In CI Chromium, that document can deny storage access, causing both smoke tests to fail before the page under test loads.

Implementation:
- Change `seedScenario()` to navigate to `buildUrl(baseURL, '/track-statsheet.html')` before writing the store.
- Pass `baseURL` from each affected test into `seedScenario()`.

Why this is minimal:
- One test helper and two call sites change.
- No runtime modules or user-facing behavior are touched.
