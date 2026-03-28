Thinking level: medium
Reason: existing browser-test harness exists, but the page imports need controlled mocking and the fix must stay narrow.

Plan:
1. Add a focused Playwright spec for the forgot-password flow on `login.html`.
2. Mock `auth.js`, `db.js`, `utils.js`, and `invite-redirect.js` at the network layer so the page can boot in isolation.
3. Run the new spec first to expose any production issue.
4. Apply the smallest page change needed to keep message state deterministic across reset attempts.
5. Re-run the focused browser spec and commit only the targeted files.
