Objective: cover the login-page forgot-password flow so CI catches regressions in the user recovery path.

Current state:
- `login.html` owns the forgot-password interaction inline.
- No browser test asserts success messaging, email clearing, or Firebase error translation.

Proposed state:
- Add browser coverage for the reset button in login mode.
- Keep the UX unchanged except for any minimal hardening needed to make error-state rendering deterministic.

Risk surface and blast radius:
- Entry-point auth page.
- High user impact if broken because locked-out users lose the recovery path.
- Low code blast radius if changes stay scoped to the reset handler and test mocks.

Assumptions:
- Existing Playwright smoke infrastructure is the correct browser-test harness for this branch.
- Mocking page imports is acceptable because the issue is about client-side flow behavior, not Firebase integration.

Recommendation:
- Add one success-path browser test and one table-driven browser test covering mapped Firebase error codes.
- If needed, normalize the message styling on each reset attempt so success state cannot leak into later validation/error states.

Success measures:
- Browser tests fail if `resetPassword` is not called, the email is not cleared, success text regresses, or mapped Firebase messages change.
