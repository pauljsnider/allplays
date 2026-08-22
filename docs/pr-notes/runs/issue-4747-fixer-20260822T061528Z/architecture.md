# Current-State Read

- `team.html` renders the production Team Pass card through `renderTeamPassCard`.
- `js/team-pass.js` already implements authenticated checkout POST creation, canonical Stripe destination validation, eligible CTA rendering, and an in-flight duplicate guard.
- Unit coverage verifies each helper in isolation.
- The missing control is browser-level coverage across rendered CTA, real production module, stubbed HTTP request, and navigation.
- `playwright.smoke.config.js` discovers `tests/smoke/**/*.spec.js`; `npm run test:smoke` invokes that config.

# Proposed Design

- Add `tests/smoke/team-pass-checkout.spec.js`.
- Serve a minimal routed HTML harness that imports the real `js/team-pass.js`, renders an eligible confirmed parent's missing-pass CTA, and binds the production checkout handler.
- Stub only Firebase Auth, App Check headers, team access, premium config, and the checkout HTTP boundary.
- Hold the valid checkout response pending to assert request shape, busy state, and duplicate suppression, then return a canonical Stripe URL and fulfill its navigation locally.
- Table-drive HTTP and hostname-lookalike destinations and assert no navigation plus retry recovery.
- Capture `pageerror` before UI assertions.

# Files And Modules Touched

- Add `tests/smoke/team-pass-checkout.spec.js`.
- Add the four required role artifacts under this run directory.
- Do not change product modules, Playwright configuration, or package scripts.

# Data/State Impacts

No Firestore, entitlement, checkout reservation, or provider state changes. All fixtures and responses are deterministic and in-memory.

# Security/Permissions Impacts

No authorization boundary changes. The harness uses an eligible principal, exercises the real bearer-token request path, and relies on the production fail-closed destination validator. All external traffic is intercepted.

# Failure Modes And Mitigations

- Duplicate requests: hold the first response and dispatch a synthetic second click.
- False-positive navigation: intercept the destination and assert the final browser URL.
- Live external dependency: fulfill Stripe navigation locally.
- Stub drift: assert collected page errors before CTA assertions.
- Brittle full-page setup: isolate the production module in a minimal browser harness.
