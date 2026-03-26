Objective: resolve the PR #396 review findings without expanding the scope beyond smoke-test reliability for Firebase auth bootstrap.

Current state:
- `tests/smoke/firebase-auth-bootstrap.spec.js` covers `login.html` and `reset-password.html`.
- The reset-password test intercepts Firebase Identity Toolkit traffic for the invalid-code path.
- `tests/smoke/helpers/boot-path.js` collects console, pageerror, requestfailed, and response issues.

Required state:
- Expected reset-password failures remain intercepted deterministically before navigation.
- Ignored error patterns suppress both console errors and page errors when those failures are part of the asserted flow.
- Route interception logic is explicit enough that unexpected Identity Toolkit traffic cannot slip through due to a brittle compound condition.

Assumptions:
- Review feedback is limited to test harness behavior; no production runtime change is needed.
- The expected invalid reset code path may log either a console error, a page error, or both depending on browser/runtime timing.

Recommendation:
- Keep the fix test-only.
- Register the Firebase route mock before any issue collection or navigation in the reset-password spec.
- Apply ignored-pattern filtering consistently in the shared issue collector.
- Split the reset-password route predicate into named guards so unmatched Identity Toolkit requests clearly pass through.

Acceptance criteria:
- `tests/smoke/firebase-auth-bootstrap.spec.js` passes locally.
- `tests/smoke/static-hosting-bootstrap.spec.js` still passes with the shared helper changes.
- No production files change.
