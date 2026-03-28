Objective: preserve the auth-bootstrap smoke guard while reducing test flake risk and keeping failure collection predictable.

Current state vs proposed state:
- Current: the helper filters ignored patterns only for console errors and the reset-password route handler uses one compound conditional.
- Proposed: ignored patterns are applied through a single matcher for both console and page errors, and the route handler uses explicit branches for URL/method/body matching.

Blast radius:
- Limited to `tests/smoke/helpers/boot-path.js` and `tests/smoke/firebase-auth-bootstrap.spec.js`.
- No runtime app modules, Firebase config, or GitHub workflow definitions change.

Risk surface:
- The helper now suppresses a slightly wider set of expected page errors when explicitly configured.
- Mitigation is the explicit per-test `ignoredConsoleErrors` opt-in rather than broad global filtering.

Rollback:
- Revert the single follow-up commit if the smoke suite stops surfacing useful failures.

What would change this decision:
- Evidence that the invalid-code path should fail on unhandled page errors instead of treating them as expected test noise.
