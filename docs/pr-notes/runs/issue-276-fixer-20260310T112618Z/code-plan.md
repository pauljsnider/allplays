Thinking level: medium
Reason: the reported production bug overlaps with code that is already fixed on this branch, so the remaining work is to confirm the true exposure and patch the narrowest path that still fails.

Implementation plan:
1. Add a regression test that fails if `accept-invite.html` still points at stale invite-flow module versions.
2. Bump the page imports for `db.js` and `accept-invite-flow.js` so browsers fetch the fixed admin invite redemption logic.
3. Run the focused invite and access-control unit tests.

What would change my mind:
- Evidence that the deployed failure is caused by a still-active inline invite implementation rather than cached module URLs, which would require a functional code-path patch instead of cache invalidation.
