Focus:
- Prevent stale cached invite assets from reintroducing the false-success admin invite path.

Primary test:
- Read `accept-invite.html` and assert it imports the fresh `db.js` and `accept-invite-flow.js` versions required for atomic admin invite redemption.

Additional validation:
1. Run the invite flow unit tests to confirm the admin acceptance path still calls `redeemAdminInviteAtomically(...)`.
2. Run the existing admin invite redemption and access-control tests to confirm `adminEmails` remains the access source of truth.

Manual spot check to recommend in PR:
1. Generate an admin invite from `edit-team.html`.
2. Open the invite link in a browser with cached assets, accept it, and verify the invited admin sees the team on `dashboard.html`.
3. Confirm edit/chat actions succeed immediately after redirect.

Residual risk:
- A client that never reloads `accept-invite.html` after deploy would still hold stale code until navigation refreshes the page.
