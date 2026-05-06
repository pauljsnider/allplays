# Architecture notes

Root cause: `team.html` imports `./js/team-pass.js?v=2`, but the smoke test route still stubs only `team-pass.js?v=1`. When the smoke page boots with mocked Firebase, the real Team Pass module can enter the module graph instead of the test stub, which is outside this test's mocked dependency surface.

Decision: keep production code unchanged. Make the smoke stub version-tolerant for Team Pass imports so cache-busting query changes do not break unrelated schedule smoke coverage.

Risks and rollback: scoped to Playwright smoke test setup only. Roll back by restoring the exact `?v=1` route if a future test intentionally needs the real Team Pass module.
