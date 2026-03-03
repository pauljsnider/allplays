# Code Role Plan

1. Update `functions/index.js`:
- Remove in-memory cache constants and read/write logic.
- Add allowlist CORS helpers using Firebase runtime config.
- Add SSRF guard helpers (private IP and DNS resolution checks).
- Make URL normalization async and enforce host validation.
- Add catch handling in `fetchWithTimeout` for abort/network errors.

2. Update `js/utils.js`:
- Replace hardcoded function URL with runtime-resolved URL helper.
- Keep existing fallback path to direct/proxy fetch when function URL is not configured.

3. Validate:
- Run Node syntax check on updated JS files.
- Review git diff for strict scope.
