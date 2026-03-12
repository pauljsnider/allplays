Validation plan:
- Run `vitest` against `tests/unit/stat-leaderboards.test.js`.
- Add regression coverage for underscore-preserving stat IDs and derived formulas that reference underscored stats.
- Add a safety regression that proves unsupported/injected syntax returns `null` instead of executing.

Success criteria:
- Unit tests pass for existing leaderboard behavior.
- Formula evaluation still handles arithmetic expressions and percent conversion.
- Formulas referencing keys like `shots_on_target` produce non-zero results when source stats include that field.
