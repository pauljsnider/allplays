Current state:
- Parent access is created through `redeemParentInvite`.
- No storage model exists for parent access requests.

Proposed design:
1. Add `teams/{teamId}/membershipRequests/{requestId}` with status values `pending`, `approved`, and `denied`.
2. Add DB helpers in `js/db.js`:
   - create/list request records
   - approve/deny requests
   - shared parent-link mutation logic
3. Add a small pure helper module to keep request IDs, status transitions, and parent-link merging testable without Firestore.
4. Extend `parent-dashboard.html` with a self-serve request card driven by public teams and roster reads.
5. Extend `edit-roster.html` with a pending requests section grouped by player and approve/deny actions.
6. Extend Firestore rules for the new subcollection:
   - requester can create/read own requests
   - team owner/admin can read and decide requests
   - writes are constrained to allowed status transitions and immutable identity fields

Blast radius comparison:
- Current: invite codes can be generated broadly and manually shared, with no explicit pending review artifact.
- New: explicit audited request docs reduce ambiguity and add a narrower approval surface.

Rollback plan:
- Revert the new helper module, DB helpers, page wiring, and `membershipRequests` rules.
- Existing invite-based onboarding remains intact.
