Scope under test:
- `tests/smoke/firebase-auth-bootstrap.spec.js`
- `tests/smoke/static-hosting-bootstrap.spec.js`
- `tests/smoke/helpers/boot-path.js`

Regression guardrails:
- Login smoke must still prove the real Firebase auth bootstrap reaches visible login UI without fatal boot issues.
- Reset-password smoke must still prove the invalid-code UI state after live module bootstrap with only the targeted Firebase API response mocked.
- Static-hosting smoke must still detect true fatal boot failures on `/` and `/dashboard.html`.

Validation plan:
- Run the focused Playwright auth smoke spec.
- Run the existing static-hosting smoke spec because the shared helper changed.
- Review `git diff --stat` and the targeted file diff for accidental scope creep.

Residual risk:
- Browser/runtime differences could still emit a different expected error string for invalid reset codes; that would require adjusting the explicit ignore pattern, not widening the helper globally.
