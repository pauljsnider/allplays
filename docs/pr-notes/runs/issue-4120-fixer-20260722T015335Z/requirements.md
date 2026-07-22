# Problem Statement

Firebase Hosting already declares and serves the candidate response-header policy, but the repository lacks an end-to-end contract proving the effective headers across root pages, React routes, assets, the scoreboard exception, and runtime config. Add regression verification without removing the GitHub Pages meta bridge before canonical cutover.

# User Segments Impacted

- Coaches, parents, players, and administrators using legacy and React surfaces.
- External sites embedding the public scoreboard.
- Platform and security operators validating candidate-host controls.

# Acceptance Criteria

1. Representative root, React shell/route, asset, widget, and runtime-config responses return HTTP 200 over HTTPS.
2. Every representative response includes CSP, HSTS, nosniff, Referrer-Policy, and Permissions-Policy.
3. Non-widget responses retain restrictive framing and never receive `frame-ancestors *`.
4. The widget alone receives `frame-ancestors *` without a conflicting restrictive ancestor directive.
5. Runtime config receives `Cache-Control: no-store`, `default-src 'none'`, `frame-ancestors 'none'`, and `Referrer-Policy: no-referrer`.
6. Verification fails with path-specific diagnostics when a contract is violated.
7. The existing staged CSP/referrer meta bridge remains unchanged.

# Non-Goals

- Canonical DNS cutover.
- App Check enforcement.
- Scoreboard API or behavior changes.
- Replacing Firebase Hosting or duplicating its configuration in another host format.

# Edge Cases

- Accept stronger host-managed HSTS values.
- Compare header and CSP semantics without depending on directive order or header casing.
- Do not hard-code changing hashed React asset names.
- Verify effective path-specific rule precedence, not only `firebase.json` text.

# Open Questions

- Tightening runtime-config Permissions-Policy beyond the inherited baseline requires a separate explicit policy decision.
