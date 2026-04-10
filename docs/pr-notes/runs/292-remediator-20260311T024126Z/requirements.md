Objective: address the two unresolved PR #292 review threads in `js/stat-leaderboards.js`.

Current state:
- Derived formulas are executed with `new Function(...)`, which permits code injection.
- Stat ID normalization strips underscores, which breaks lookups against persisted aggregate stat keys such as `shots_on_target`.

Required change:
- Preserve underscores in stat ID normalization so derived formulas and base stat reads resolve stored keys correctly.
- Replace dynamic code generation with a safe evaluator that supports the existing arithmetic subset used by formulas.

Constraints:
- Keep the change scoped to the review feedback only.
- Maintain current supported formula behavior for arithmetic expressions and percent notation.
- Validate with the existing focused unit tests plus added regression coverage.
