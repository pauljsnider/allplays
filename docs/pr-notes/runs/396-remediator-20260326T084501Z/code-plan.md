Plan:
1. Update `tests/smoke/helpers/boot-path.js` to preserve `baseURL` path prefixes and keep ignored error filtering explicit.
2. Update `tests/smoke/firebase-auth-bootstrap.spec.js` to create the collector after `page.route()` and fail closed for unexpected reset-password API calls.
3. Run the affected smoke spec and inspect git diff before committing.
