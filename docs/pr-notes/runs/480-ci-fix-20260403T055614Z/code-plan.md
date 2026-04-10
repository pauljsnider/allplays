Minimal change:
- Update `login.html` to import `js/login-page.js` as a namespace rather than named exports.
- Add a local fallback auth-state manager factory for environments that provide the older module shape.
- Keep existing behavior by using the real exported function when available.

Why this path:
- Fixes preview smoke immediately.
- Keeps the runtime compatible with both current and older module surfaces.
- Avoids touching test code or unrelated auth logic.
