Test focus:
- Confirm the homepage Help Center navigation assertion pre-registers its navigation waiter.
- Confirm shared-footer destination assertions on `/login.html` are unchanged.

Regression guardrails:
- Keep `help.html` and `https://paulsnider.net` href assertions intact.
- Do not widen the selector surface or add unrelated timing waits.

Validation status:
- `git diff -- tests/smoke/footer-support-links.spec.js` confirms the click path now uses `const navigationPromise = page.waitForURL(...)` before `helpLink.click()`.
- Browser execution was not completed in this environment because Playwright reported missing Linux runtime libraries after `npx playwright install chromium`.

Residual risk:
- `login.html` remains a somewhat noisier shared-footer target than a simpler public page, but that is outside the scope of this review comment.
