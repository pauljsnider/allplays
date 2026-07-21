# Patch Plan

1. Add a regression test showing that account emails survive the current shared sanitizer.
2. Add `redactEmailAddresses` and compose it with the existing free-form secret redactors.
3. Route non-sensitive-key strings through the composed sanitizer.
4. Run the focused app logger test and `git diff --check`.

# Code Changes Applied

None during role analysis. Intended changes are limited to `logger.ts` and `logger.test.ts`.

# Validation Run

The code role ran the current-master baseline: one logger test file passed with six tests. Post-patch validation remains for the main run.

# Residual Risks

The pragmatic regex may miss unusual address syntax. Direct `console.*` calls bypass the shared sanitizer and remain out of scope. Recurrence risk is low once the centralized regression is present.

# Commit Message Draft

`Redact email addresses from auth logs (#4101)`
