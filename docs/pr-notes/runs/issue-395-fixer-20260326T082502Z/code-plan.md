## Plan
- Add a shared smoke helper for boot issue collection and cache-busted URLs.
- Add `tests/smoke/firebase-auth-bootstrap.spec.js` for login and reset-password entrypoints.
- Keep the patch test-focused unless the new coverage exposes a production failure.

## Implementation Notes
- Reuse the existing Playwright smoke config.
- Intercept only the Firebase Auth reset-code verification request needed for deterministic invalid-code coverage.
- Preserve the existing static-hosting smoke spec, but move common boot-check logic into the shared helper if that reduces duplication cleanly.

## Expected Files
- `tests/smoke/firebase-auth-bootstrap.spec.js`
- `tests/smoke/helpers/boot-path.js`
- `tests/smoke/static-hosting-bootstrap.spec.js` if helper extraction is used
