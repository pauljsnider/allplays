# Session-lifetime authenticated smoke diagnostics

Review candidate based on frozen `b5f2514b9f60520fb15b579506d8b25b0cac6f3b`
(production base `042a7cdd5c25131f49e765ae8719dc1667978ef4`). The original
candidate remains unchanged. This revision only prepares diagnostics locally;
it does not fix or attribute the production HTTP 403 root cause.

The core suite opts into one recorder per authenticated session before sign-in.
Each bounded recorder stays attached during other sessions' tests and is disposed
before its browser context closes. Setup failures attach that session's evidence;
partial setup failure also attaches and closes successful peer sessions. A later
test failure attaches the failing session and its idle peer separately, so a
serial-test skip cannot erase the peer's evidence. Other smoke suites retain the
existing short-lived diagnostic wrapper unless they explicitly opt in.

Artifacts use numeric session indices (0 staff, 1 parent for this core suite),
never account identifiers. Events retain allowlisted service/resource/status,
templated route and asset categories, and existing bounded metadata. A captured
`responseTimeRoute` describes where the page was when the event was observed,
not the request's originating route or root cause. Query strings, credentials,
request bodies, arbitrary headers, document IDs and raw URLs are not recorded.
The 40-event limit remains, with `droppedEvents` explicitly reporting overflow.
Artifacts remain best effort within the existing one-second collection budget;
assertions, errors, and strict flaky-release gates are unchanged.

Validation: 36 tests across seven Vitest files passed. Five new behavioral tests
failed against the frozen baseline and passed on the revision. They execute the
actual authentication helper and core spec with mocked browser readiness:

1. Staff sign-in 403 retained when the accumulated assertion fails at `/help`.
2. Idle parent 403 during staff workflow retained for the later parent assertion.
3. Idle parent evidence attached when staff failure skips the parent test.
4. Failed sign-in and successful-peer evidence attached before cleanup.
5. 40-event bound, visible overflow, and listener disposal.

Existing tests cover fetch/image/XHR attribution, sanitization and hostile
metadata, collection deadlines, original-error preservation, bounded close,
and smoke setup/assertion wiring. These are offline tests, not a credentialed
production smoke run; no normal or strict rerun was initiated.

```sh
./node_modules/.bin/vitest run \
  tests/unit/app-session-smoke-diagnostic.test.js \
  tests/unit/app-authenticated-smoke-diagnostic.test.js \
  tests/unit/app-route-diagnostic.test.js \
  tests/unit/app-auth-smoke-helper.test.js \
  tests/unit/production-smoke-auth-setup-timeout.test.js \
  tests/unit/app-admin-smoke-diagnostic.test.js \
  tests/unit/smoke-diagnostic-upload.test.js --reporter=verbose
```
