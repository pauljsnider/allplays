# Issue 377 QA Notes

## Coverage Targets
- Finish flow saves reconciled score instead of mismatched manually entered score when the score log is trustworthy.
- Finish flow persists opponent stats and aggregated player stats in the expected shape.
- Finish flow redirects directly to the game page when recap email is disabled.
- Finish flow hits `mailto:` first and then the game page when recap email is enabled.

## Regression Guardrails
- Keep assertions on `status: completed`.
- Assert opponent stat snapshot includes identity fields plus stat columns and fouls.
- Assert navigation plan order, not just presence of a `mailto:` string.

## Validation Plan
- Run the new targeted finish-flow unit tests.
- Run existing live-tracker unit coverage to confirm no regression in related helpers.

## Residual Risk
- Full DOM/browser interaction remains lightly covered on this branch because there is no established live-tracker e2e harness in CI.
