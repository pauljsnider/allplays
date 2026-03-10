Scope: manual verification only; repo has no automated test runner in `AGENTS.md` or `CLAUDE.md`.

Checks:
1. Review diff to confirm `dashboard.html` now passes `user.email || profile?.email`.
2. Confirm no unrelated files changed beyond required PR notes.
3. If run manually in browser, verify an existing Google user whose Firestore profile email differs from auth email still sees admin teams tied to the auth email.

Residual risk:
- Other pages may make similar email-source choices, but this PR thread is specific to dashboard access lookup.
