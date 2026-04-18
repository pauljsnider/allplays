# QA Plan
- Run the scoped Vitest unit file covering help-page-reference integrity.
- Run the scoped Playwright smoke spec against a local static server to confirm the new fallback detection passes.

# Test Cases
- Unit: the help page reference integrity test can read repo files and confirm referenced HTML files exist.
- Smoke: each workflow and page-reference HTML file returns `ok() === true` and HTML content distinct from `/index.html`.
- Smoke regression: help center navigation and filtering assertions continue to pass unchanged.

# Residual Risk
- The smoke assertion detects rewrite fallback by comparing response bodies, so it would only miss a case where a help file became byte-for-byte identical to `index.html`, which is not a realistic repo state.
