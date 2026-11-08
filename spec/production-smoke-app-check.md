# Production smoke App Check attestation

Headless CI is not a valid reCAPTCHA client. Production browser smoke uses
Firebase's documented CI debug provider while ordinary clients continue to use
reCAPTCHA Enterprise. This does not verify the ordinary browser's reCAPTCHA
assessment; that requires separate real-browser evidence. Auth and data access
rules still apply to the dedicated smoke users.

Register one dedicated debug token for the production web app in Firebase App
Check and store its value only as `SMOKE_APP_CHECK_DEBUG_TOKEN` in GitHub's
protected `production-smoke` environment. Keep the environment restricted to
protected branches. Never put the token in repository variables, a build env,
public runtime config, a PR workflow, a browser trace, or diagnostic output.
See https://firebase.google.com/docs/app-check/web/debug-provider.

Post-deploy and scheduled production browser steps require this secret. The test
helper installs it before Firebase loads, only on the exact allowlisted HTTPS
top-level origin. It requires `token-ready` before proceeding. Missing credentials,
unregistered tokens, exchange failures, and timeouts fail smoke. Existing console
and network assertions remain in force. Preview and local runs without the
protected configuration remain unchanged.

To revoke CI access, delete this dedicated token from Firebase App Check and
remove the GitHub environment secret. Production smoke will fail closed until a
replacement registered token is supplied. Do not disable production enforcement
or suppress token-exchange failures to restore green checks.

Validation: focused unit boundary tests plus the synthetic Chromium spec
`tests/smoke/app-check-ci-provider.spec.js`; same-artifact production boot using
registered CI attestation; then exact merge-SHA deploy, release marker and full
post-deploy smoke. Operator repairs do not count toward bot delivery throughput.
