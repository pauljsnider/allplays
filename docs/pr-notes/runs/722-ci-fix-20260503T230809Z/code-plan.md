# Code Plan: PR #722 CI Fix

## Files
- `tests/smoke/edit-roster-bulk-ai-reset.spec.js`

## Change
In `openBulkAiTab`, wait for the mocked team name to render before clicking the Bulk AI tab. Then assert `#content-bulk-ai` is visible before the helper returns.

## Why
This synchronizes the smoke test with page bootstrap instead of racing inline module listener registration. The fix is scoped to the flaky smoke helper and does not change production behavior.
