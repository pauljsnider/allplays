# Code Role Synthesis (fallback; subagent infra unavailable)

## Plan
1. Add helper module for live practice note append behavior so it is unit-testable.
2. Add failing unit test to enforce: append to `notesLog` only, preserve existing `notes`.
3. Wire `drills.html` `appendPracticeNote` to helper.
4. Run targeted unit test and ensure pass.
5. Stage and commit docs + test + fix with issue reference.

## Non-goals
- No render-layer dedupe logic.
- No historical data migration.
