## Architecture Decisions
- Treat this as a test-only path-resolution problem, not a Help Center page architecture problem.
- Keep the integrity guard in `tests/unit/help-page-reference-integrity.test.js`, but derive repo paths with Node filesystem utilities instead of `new URL(...).pathname`.
- Prefer `fileURLToPath(import.meta.url)` plus `dirname/resolve` over the suggested regex patch.

## Constraints
- ALL PLAYS is a static site with no build step.
- The failing behavior exists in the Node/Vitest unit test layer only.
- The page reference is hand-maintained static HTML, so the integrity guard must stay simple, deterministic, and cross-platform.

## Minimal Safe Change
- Replace the repo-root helper with:
  - `const TEST_DIR = dirname(fileURLToPath(import.meta.url));`
  - `const REPO_ROOT = resolve(TEST_DIR, '../..');`
- Leave `help.html`, `help-page-reference.html`, and `tests/smoke/help-center.spec.js` unchanged for this comment.

## Risks And Rollback
- Regex normalization is narrower and easier to get wrong than `fileURLToPath`.
- Product/runtime risk is effectively zero because the change is test-only.
- Rollback is trivial: revert the repo-root helper in the unit test.
