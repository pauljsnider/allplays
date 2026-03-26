## Objective
- Add CI coverage for the real Firebase bootstrap path on `login.html` and `reset-password.html`.

## Current State
- Existing auth unit tests mock `js/firebase.js` or bypass the live page boot path.
- Existing smoke coverage only checks homepage/dashboard boot and does not assert auth entrypoints survive real Firebase initialization.

## Proposed State
- Add Playwright smoke coverage that loads the live auth pages with their real module graph.
- Treat page errors, failed module requests, and fatal console errors as test failures.
- Assert the login form and Google button render after boot.
- Assert reset-password can show a user-actionable invalid-link state without startup crash.

## Risk Surface
- Blast radius is limited to smoke coverage and shared smoke-test helpers.
- No tenant data, auth credentials, or production config changes.
- Main false-positive risk is overmatching benign console noise; helper should stay specific to fatal signals.

## Assumptions
- Firebase runtime config fallback in `js/firebase-runtime-config.js` is the intended production path when `/__/firebase/init.json` is absent.
- Invalid reset-code behavior can be simulated by routing the Firebase Auth backend call in Playwright.
- The requested orchestration skill and subagent tooling are not exposed in this session, so this artifact captures the role synthesis directly.

## Recommendation
- Add a focused smoke spec for auth bootstrap rather than widening all existing smoke tests.
- Reuse a small shared issue collector so auth pages fail on real boot regressions without adding brittle assertions.

## Success Criteria
- CI has a Playwright smoke test for `/login.html` and `/reset-password.html`.
- The tests fail on page boot errors and failed auth-module requests.
- `reset-password.html` shows its invalid-link state when Firebase rejects the reset code.
