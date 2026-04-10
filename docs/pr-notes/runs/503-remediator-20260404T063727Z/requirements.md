Objective: address the two unresolved review comments on `tests/smoke/login-invite-redirect.spec.js`.

Current state: test mocks generate JavaScript module source with direct interpolation of serialized test data inside a template literal.
Proposed state: test mocks pass structured data through a transport-safe encoding and decode it inside the generated module source.

Risk surface: only Playwright smoke-test mocking in one spec file. No production code path changes.
Blast radius: confined to `login-invite-redirect.spec.js`.

Assumptions:
- Review feedback applies only to the mocked `auth.js` and `db.js` module bodies.
- Node `Buffer` is available in the Playwright test runtime.
- Minimal change is preferred over refactoring the mocking approach.

Recommendation: encode mock payloads before interpolation and parse them inside the mock module source. This removes template-literal breakout risk while preserving current test behavior.
