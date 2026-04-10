Objective: add coverage without introducing a larger auth-page refactor.

Current state:
- `login.html` statically imports `auth.js`, `db.js`, `utils.js`, and `invite-redirect.js`.
- The forgot-password handler mutates DOM state directly inside the page script.

Proposed state:
- Reuse the existing page and intercept imported modules in Playwright with lightweight test doubles.
- Keep production behavior intact, with only a minimal handler adjustment if state normalization is required.

Controls and blast radius:
- No backend or Firebase rules changes.
- No auth API contract changes.
- Page-local JavaScript only.

Tradeoff:
- Browser-route mocks keep runtime fidelity on the DOM side while avoiding live Firebase dependencies.
- A small production hardening change is acceptable if it reduces flaky UI state across repeated reset attempts.

Rollback:
- Revert the added spec and the page-local reset-handler adjustment.
