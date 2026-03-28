## QA Role Summary

- Primary regression risk: the broader import matcher could miss or over-match import blocks from the same module.
- Guardrail added: assert that mutated `?v=` values still produce rewritten source with no raw `db`, `firebase`, `utils`, or `auth` imports left behind.
- Validation target:
  - `tests/unit/live-tracker-opponent-stats.test.js`
- Acceptance criteria:
  - New harness-specific test passes.
  - Existing opponent hydration and opponent-removal regression tests continue to pass.
