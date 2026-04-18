# Issue #513 QA Synthesis

## QA Plan
- Add focused Playwright coverage for Help Center runtime behavior on `help.html` and `help-page-reference.html`.
- Add a deterministic unit-level integrity test for page-reference file listings so stale references fail fast without browser flake.
- Validate only the changed area with targeted unit and smoke commands.

## Coverage Matrix
- `help.html`
  - manifest-driven initial render
  - role filter narrowing
  - search narrowing
  - combined result summary updates
  - empty-state visibility when zero matches
  - navigation into a workflow page and back
- `help-page-reference.html`
  - page renders
  - key rows present
  - back link returns to Help Center
  - listed `.html` file references exist

## Failure Modes To Catch
- Manifest drift that breaks runtime rendering or counts.
- Search/filter regressions that hide valid workflows or fail to show empty state.
- Broken workflow navigation from Help Center cards.
- Hand-maintained reference rows that point at missing files.

## Recommended Validation Commands
- `npm run test:unit -- tests/unit/help-navigation-wiring.test.js tests/unit/help-page-reference-integrity.test.js`
- `npx playwright test --config=playwright.smoke.config.js tests/smoke/help-center.spec.js`
