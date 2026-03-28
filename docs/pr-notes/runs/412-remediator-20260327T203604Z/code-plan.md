Thinking level: low
Role: Code
Plan:
1. Inspect login.html import list and js/login-page.js exports.
2. Add a mocked /js/login-page.js route inside mockLoginPageModules with createForgotPasswordHandler and the same message mapping used by the test.
3. Run the affected Playwright smoke spec if the toolchain is present.
4. Stage the spec and role notes, then commit with a short imperative message.
