Decision: apply a minimal smoke-test-only patch.

Patch summary:
1. Replace the homepage `waitForURL` waiter with `waitForNavigation({ url: '**/help.html' })`.
2. Capture the returned navigation response and assert it is present and successful.
3. Preserve the existing pathname assertion.
4. Add a visible heading assertion for `ALL PLAYS Help Center`.

Why this shape:
- It directly addresses the review note.
- It avoids touching production HTML or JS.
- It keeps the shared-footer coverage on `login.html` intact.
