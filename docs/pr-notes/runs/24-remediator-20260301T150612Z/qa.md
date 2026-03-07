# QA role notes

## Verification plan
1. `bash -n scripts/nightly-playwright-smoke.sh`
2. Spot-check script sections for:
   - token redaction patterns
   - placeholder validation gate
   - direct argv execution (no `bash -lc`)
   - lock fd 9 EXIT trap
3. `git diff -- scripts/nightly-playwright-smoke.sh config/nightly-playwright-smoke.env.example`

## Acceptance criteria
- Script syntax passes.
- New logic stays scoped to review comments.
- No unrelated files changed except required role-note artifacts.
