# Issue #513 Code Plan Synthesis

## Implementation Plan
1. Add a new Playwright smoke spec for Help Center discovery and page-reference navigation.
2. Reuse existing smoke helpers so URL building stays compatible with prefixed base paths.
3. Add a unit integrity test that parses `help-page-reference.html` and asserts each listed `.html` file exists on disk.
4. Remove or correct the stale `check-admin-status.html` row in `help-page-reference.html` so the integrity test passes.

## Candidate Test Files
- `tests/smoke/help-center.spec.js`
- `tests/unit/help-page-reference-integrity.test.js`

## Minimal Patch Shape
- New Playwright smoke test, no config changes.
- New unit integrity test.
- Small content-only fix in `help-page-reference.html`.

## Risks
- The current page-reference document is already stale, so the new integrity guard should fail before the fix.
- Keep browser coverage focused on help pages and not auth-dependent app routes to avoid false negatives.
