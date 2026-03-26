Scope:
- `tests/smoke/footer-support-links.spec.js`
- `tests/smoke/helpers/boot-path.js` behavior exercised via import and regression assertion

Primary regression to guard:
- `baseURL` with a pathname prefix must keep that prefix when callers pass absolute smoke paths.

Validation plan:
- Run the targeted Playwright footer smoke spec.
- Verify the new regression assertion passes.
- Confirm the existing footer link navigation checks still pass.

Concrete commands:
- `pnpm exec playwright test tests/smoke/footer-support-links.spec.js --config=playwright.smoke.config.js --reporter=line`

Impacted workflows verified:
- Homepage footer smoke route generation for `/`
- Login-page footer smoke route generation for `/login.html`
- Shared smoke helper route generation for subpath-mounted deployments

Residual risk:
- Broader smoke specs that still use bespoke URL handling would need separate review, but this patch removes the known duplication in the affected footer suite.
