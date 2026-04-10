Thinking level: low
Role: QA
Validation target: tests/smoke/login-forgot-password.spec.js under playwright.smoke.config.js.
Expected outcome: page loads without module import failure and existing assertions for success, Firebase error mapping, and style reset continue to pass.
Environment finding: Playwright command is unavailable in this checkout, so execution is currently blocked by missing tooling rather than test failures.
Residual risk: the inline mock duplicates login-page.js logic and can drift if production forgot-password behavior changes later.
