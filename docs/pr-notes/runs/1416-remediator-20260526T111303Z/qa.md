# QA

Regression coverage:
- reloadCurrentUser returns false while auth.refresh returns a verified user, expect navigation to dashboard and no "could not confirm" message.
- reloadCurrentUser returns false and auth.refresh returns unverified/null, expect user remains on verify pending with secondary options.
- Already verified users still see the direct continue link.

Validation commands run:
- npm exec -- vitest run tests/unit/app-verify-pending.test.jsx --reporter=dot
- npm run app:build
