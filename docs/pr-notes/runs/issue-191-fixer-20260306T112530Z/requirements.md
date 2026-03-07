Objective: ensure an admin invite code can grant coach access exactly once.

Current state:
- `accept-invite.html` uses the atomic redemption helper.
- `js/accept-invite-flow.js` still contains a fallback path that grants access before consuming the code if the atomic helper is absent.

Proposed state:
- Admin invite redemption in the accept-invite flow fails closed unless the atomic redemption helper is available.

Risk surface and blast radius:
- Area is limited to admin invite redemption.
- Failing closed is safer than allowing elevated access with non-atomic persistence.

Assumptions:
- `accept-invite.html` is the production caller and always provides `redeemAdminInviteAtomically`.
- No supported caller relies on the legacy fallback behavior.

Recommendation:
- Remove the non-atomic fallback from `js/accept-invite-flow.js`.
- Add a regression test that rejects admin invite processing when the atomic handler is missing.

Success criteria:
- Admin invite processing uses the atomic redemption callback when present.
- Admin invite processing rejects when the atomic callback is missing.
- Targeted invite-flow tests pass.
