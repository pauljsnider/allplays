# Code plan

Subagent role spawning was unavailable in this environment, so this note captures inline code analysis.

## Implementation plan
1. In `RegistrationDetail.tsx`, after unpublished checks, reject `nextForm.onlineCheckout` by setting the existing unavailable state.
2. Add a submit-time guard for `form.onlineCheckout` before validation or service calls.
3. Extend `tests/unit/app-registration-detail.test.jsx` with a regression test for the deep-link bypass.
