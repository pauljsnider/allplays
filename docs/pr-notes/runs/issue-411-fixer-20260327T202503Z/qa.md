Objective: close the regression gap around password-reset UX on `login.html`.

Primary risks:
- Reset button stops calling `resetPassword`.
- Success text regresses or disappears.
- Email field is not cleared after success.
- Raw Firebase error strings leak instead of mapped user messages.

Coverage plan:
- Browser test: enter email, click forgot-password, assert mock call, cleared field, success text, and same-page URL.
- Browser test: inject `auth/invalid-email`, `auth/user-not-found`, and `auth/too-many-requests`; assert same-page URL and mapped messages.

Residual risks:
- Live Firebase delivery is still outside browser-test scope.
- Login/signup submit flows remain covered by other tests, not this issue.

Validation:
- Run the focused Playwright spec.
- Run relevant Vitest tests if any touched helper or wiring code changes warrant it.
