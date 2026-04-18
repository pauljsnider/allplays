# Issue #513 Architecture Synthesis

## Architecture Decisions
- Add a dedicated Playwright smoke spec for the Help Center instead of folding these checks into generic boot smoke.
- Test the shipped static pages, especially `help.html`, because the runtime behavior lives in inline manifest parsing and inline filter/search logic.
- Split risk coverage into browser interaction for help UX and lightweight existence checks for advertised reference targets.

## Constraints
- The app is a static site with no build step.
- Many application pages require auth or Firebase, so help reference integrity should avoid brittle deep-boot assertions.
- `help-page-reference.html` is hand-maintained, which makes drift the primary failure mode.

## Minimal Safe Change
- Add one new Playwright smoke spec under `tests/smoke/` that covers Help Center discovery, filtering, empty state, workflow navigation, and page-reference navigation.
- Add one lightweight unit integrity guard that parses `help-page-reference.html` and verifies listed `.html` files exist on disk.
- Fix the stale `check-admin-status.html` entry so the new integrity guard passes.

## Risks And Rollback
- Stronger integrity checks will surface real drift immediately, which is intended.
- Avoid testing full runtime boot for every page in the reference table to keep smoke coverage stable.
- Rollback is straightforward: revert the new tests and the stale reference cleanup if needed.
