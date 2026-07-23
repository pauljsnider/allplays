# Current-State Read

- `allplays.ai` currently uses GitHub Pages and the repository `CNAME`.
- The Firebase Hosting candidate is `https://game-flow-c6311.web.app`.
- Public, response-header, and authenticated candidate checks already exist.
- GitHub Pages staging injects a temporary meta CSP bridge. Firebase Hosting
  supplies CSP and related controls as HTTP response headers.
- No runbook currently joins these controls into a cutover or rollback gate.

# Proposed Design

Add one operational source of truth at `docs/hosting-cutover-runbook.md`. It
records the pre-change DNS state, runs the existing candidate checks, validates
DNS and TLS, defines post-change verification, and restores the exact saved DNS
state on rollback. Add a narrow App Check cross-reference and a documentation
contract test.

# Files And Modules Touched

- `docs/hosting-cutover-runbook.md`
- `docs/firebase-app-check-rollout.md`
- `tests/unit/hosting-cutover-runbook.test.js`
- Per-run planning artifacts under this directory

# Data/State Impacts

No application, Firestore, authentication, DNS, or hosting state changes. The
runbook governs later operational changes and evidence capture.

# Security/Permissions Impacts

No new permissions. DNS mutation remains limited to authorized operators. App
Check remains **Unenforced**, TLS verification cannot be bypassed, and captured
evidence must exclude credentials, tokens, cookies, and user data.

# Failure Modes And Mitigations

- Partial DNS convergence: keep both origins viable and query authoritative plus
  two public recursive resolvers through the prior maximum TTL.
- TLS not ready: block or roll back on trust, hostname, validity, or handshake
  failure.
- Public success but auth failure: require both smoke classes before and after
  cutover.
- Missing security headers: run response-header verification on the candidate
  and canonical production origins.
- Stale rollback values: require a verified provider export before cutover.
- Early meta bridge removal: require a separate reviewed change backed by
  converged DNS, TLS, headers, smoke, monitoring, and approval evidence.
