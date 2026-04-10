Validation focus:
- Basketball config with explicit `baseType` still returns `true`.
- Non-basketball config still returns `false`.
- Missing config id still falls back to team sport.
- Existing config missing `baseType` now falls back to team sport.

Regression guardrails:
- Keep the test in `test-pr-changes.html` aligned with the page helper logic.
- Validate the case-insensitive `baseType` path still works.
- Validate invalid config id still falls back to team sport.

Manual spot check recommendation:
- Open `test-pr-changes.html` in a browser and confirm all basketball detection cases pass.
