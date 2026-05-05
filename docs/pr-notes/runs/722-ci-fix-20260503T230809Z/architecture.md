# Architecture Notes: PR #722 CI Fix

## Root cause
The failing preview-smoke assertions are caused by smoke-test synchronization drift. The helper clicked the Bulk AI tab immediately after `domcontentloaded`, which can race the inline ES module bootstrap and tab listener registration in static preview runs. When the click lands too early, the Bulk AI panel never opens and the image preview remains hidden after upload.

## Minimal fix
Keep production code unchanged. Update only the smoke helper to wait for the mocked team bootstrap signal (`#team-name-display` rendering `Test Team`), then click the Bulk AI tab and assert the tab content is visible before uploading an image.

## Risk and rollback
No production data, Firebase, auth, or permission behavior changes. Rollback is a single test helper change if needed.
