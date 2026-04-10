Failure observed:
- `preview-smoke` fails three forgot-password tests on `tests/smoke/login-forgot-password.spec.js`.
- Symptoms: email input is not cleared and `#error-message` remains empty/hidden after clicking the button.

Root cause hypothesis:
- Page module initialization aborts before the forgot-password listener is attached because the mocked `js/login-page.js` does not export `createLoginAuthStateManager`.

Validation plan:
- Run the targeted Playwright smoke file after patching.
- Confirm success path clears email and shows confirmation.
- Confirm Firebase error mapping still surfaces the expected messages.
- Confirm post-success validation state resets back to red styling.
