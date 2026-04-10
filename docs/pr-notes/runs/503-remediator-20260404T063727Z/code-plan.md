Implementation plan:
1. Add a small helper in `tests/smoke/login-invite-redirect.spec.js` to base64-encode JSON payloads for safe embedding.
2. Update the mocked `auth.js` module source to decode and parse `loginResult`, `googleRedirectResult`, and `defaultRedirect`.
3. Update the mocked `db.js` module source to decode and parse `profile`.
4. Run the affected Playwright spec.
5. Commit only the scoped changes.
