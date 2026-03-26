Decision: apply a minimal smoke-test-only patch.

Planned changes:
1. Add a small helper matcher in `tests/smoke/helpers/boot-path.js` so ignored patterns are reused consistently.
2. Filter `pageerror` events through that matcher before recording issues.
3. Refactor the Firebase Identity Toolkit route handler in `tests/smoke/firebase-auth-bootstrap.spec.js` into explicit guard branches.
4. Keep route registration ahead of collector setup and navigation in the reset-password test.

Non-goals:
- No production HTML or JS changes.
- No expansion of the smoke suite or workflow definitions.
