Objective: cover the real workflow without introducing a new test harness.

Current state:
- `edit-config.html` loads its logic inline and depends on shared ES modules.
- The repo already uses Playwright smoke tests with `page.route()` stubs to exercise page behavior under controlled dependencies.

Proposed state:
- Reuse the existing smoke pattern to stub `db.js`, `auth.js`, `utils.js`, and `team-admin-banner.js`.
- Drive `edit-config.html` through a platform-admin session and assert no redirect, banner render, config visibility, create, and delete behavior.

Risk surface and blast radius:
- Test-only changes have low runtime blast radius.
- One runtime hardening change on module import cache busting is isolated to `edit-config.html`.

Tradeoffs:
- This is not a full backend/firestore-rules integration test.
- It is the smallest change that verifies page behavior end to end in the repo’s existing automation model.
