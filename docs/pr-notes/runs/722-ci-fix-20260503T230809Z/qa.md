# QA Notes: PR #722 CI Fix

## Validation target
Affected coverage is `tests/smoke/edit-roster-bulk-ai-reset.spec.js`, specifically the Bulk AI cancel/reset flows that upload a roster image.

## Test command
Run the targeted preview smoke spec against a static server:

```bash
SMOKE_BASE_URL=http://127.0.0.1:4173 SMOKE_SUITE=preview \
  npx playwright test --config=playwright.smoke.config.js tests/smoke/edit-roster-bulk-ai-reset.spec.js --reporter=line
```

## Expected result
Both Bulk AI smoke tests pass, including image preview visibility after upload and clearing stale image state after cancel.
