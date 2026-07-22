# Current-State Read

- The candidate origin is Firebase Hosting at `https://game-flow-c6311.web.app`.
- `firebase.json` is already the centralized source for global, widget, and runtime-config response headers.
- `scripts/write-firebase-hosting-config.mjs` carries those rules into the generated deployment configuration.
- Static configuration tests exist, but no automated live check detects deploy omission, precedence drift, or effective host behavior.

# Proposed Design

- Keep Firebase Hosting and `firebase.json` as the single policy source.
- Add a Node 22 response-header verifier with dependency-injected fetch and a CLI.
- Check root, React shell/direct route, a stable asset, widget, and runtime config.
- Validate HSTS semantically with `max-age >= 31536000`.
- Run the verifier in post-deploy smoke against the candidate origin before canonical browser smoke.

# Files And Modules Touched

- `scripts/verify-response-headers.mjs`
- `tests/unit/verify-response-headers.test.js`
- `.github/workflows/post-deploy-smoke.yml`

# Data/State Impacts

No Firestore, Storage, authentication, tenant, PHI, DNS, or application-state changes. The check performs anonymous read-only HTTPS requests.

# Security/Permissions Impacts

The verifier guards the default clickjacking boundary, the widget-only embedding exception, and the runtime-config no-store/non-frameable contract. No permissions are expanded.

# Failure Modes And Mitigations

- Deployment/config drift: validate live responses after deployment.
- Widget exception leakage: assert opposing ancestor policies on widget and non-widget paths.
- Stale runtime config: require no-store and restrictive CSP.
- Stronger platform HSTS: enforce a minimum rather than exact equality.
- CDN propagation delay: use bounded retries with path-specific errors.
- Meta bridge regression: leave staging code unchanged and retain its existing focused tests.
