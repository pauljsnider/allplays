Objective: preserve base-path correctness in smoke URL construction for PR #396 without changing product code.

Current state:
- `tests/smoke/helpers/boot-path.js` already preserves a `baseURL` pathname prefix when building cache-busted smoke URLs.
- `tests/smoke/footer-support-links.spec.js` still defines its own inline `buildUrl(baseURL, path)` using `new URL(path, \`${baseURL}/\`)`.
- When `baseURL` is mounted under a subpath such as `https://host/app`, absolute smoke paths like `/login.html` resolve to `https://host/login.html` instead of `https://host/app/login.html`.

Proposed state:
- Reuse the shared smoke helper in the footer support-links spec so all smoke navigation honors the same base-path-safe URL semantics.
- Add a focused regression assertion proving absolute smoke paths keep the base pathname prefix.

Risk surface and blast radius:
- Limited to Playwright smoke tests.
- No user-facing runtime code, Firebase behavior, or deployment config changes.
- Main risk is overfitting the regression assertion to one URL shape; keep it narrow and deterministic.

Assumptions:
- Smoke environments may be served from a non-root pathname.
- The smoke test contract is to navigate within the deployed app base path, not the domain root.
- Reusing the shared helper is preferable to maintaining duplicate URL logic.

Recommendation:
- Replace the inline helper with the shared helper and add one small regression test in the same spec.

Success criteria:
- Footer smoke navigation still passes for root deployments.
- A direct assertion proves `buildUrl('https://host/app', '/login.html')` retains `/app/login.html`.
