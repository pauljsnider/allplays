Current state:
- `accept-invite.html` delegates admin invite handling to `js/accept-invite-flow.js`.
- `js/accept-invite-flow.js` calls `redeemAdminInviteAtomically(...)` from `js/db.js`, which appends the normalized email to `adminEmails`, adds coach membership, and marks the code used in a transaction.
- Because the page still imports `db.js?v=14` and `accept-invite-flow.js?v=2`, browsers can reuse cached pre-fix assets for this path.

Proposed state:
- Bump the `accept-invite.html` module URLs so the page loads the fixed redemption code path immediately after deploy.

Blast radius:
- One HTML entry point and one regression test.
- No data model or Firestore rule changes.

Tradeoff:
- Minimal blast-radius cache invalidation versus broader refactoring of invite flow modules that are already correct on this branch.

Rollback:
- Revert the import version bump if it causes an unexpected asset-loading issue, although risk is low because the module APIs are unchanged.

Note:
- The requested `allplays-orchestrator-playbook` skill and `sessions_spawn` subagent tooling were not available in this session, so these notes capture the equivalent role synthesis directly.
