Thinking level: low
Role: Requirements
Objective: remediate PR #412 review feedback in the forgot-password smoke test.
Current state: login.html imports auth, invite-redirect, and login-page modules; the smoke test only mocks the first two.
Proposed state: add a login-page module mock that exports createForgotPasswordHandler and preserves the tested forgot-password behavior.
Risk surface: test-only change, limited to smoke test harness behavior.
Assumptions: no production file changes are required and both review threads point to the same missing mock.
