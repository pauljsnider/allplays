## Coverage Target
- Homepage hero CTA routing for authenticated parent users
- Homepage hero CTA routing for authenticated coach users
- Guest CTA regression guardrail

## Test Strategy
1. Extend `tests/unit/homepage-index.test.js`.
2. Add an authenticated parent case and assert CTA text is `Go to Dashboard` while href is `parent-dashboard.html`.
3. Keep an authenticated coach case asserting href is `dashboard.html`.
4. Preserve guest CTA assertions to catch unintended regression.

## Validation Notes
- Preferred command: `npm test -- tests/unit/homepage-index.test.js`
- Secondary command: `npm test` to confirm the broader unit suite still passes.
- If Playwright is later required for browser-level CTA click coverage, add it as a follow-up; the repo’s existing automated homepage coverage is currently in Vitest.
