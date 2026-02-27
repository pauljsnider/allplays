# Code Role (allplays-code-expert equivalent)

## Minimal Patch Plan
1. Create `js/accept-invite-flow.js` exporting `processInviteCode(userId, code, deps)`.
2. Move invite branching logic from inline HTML function to helper and inject DB dependencies.
3. Add `markAccessCodeAsUsed` call to admin path (after profile update succeeds).
4. Add unit tests under `tests/unit/accept-invite-flow.test.js` that fail when consumption call is missing.
5. Update `accept-invite.html` imports to use helper and remove stale comment about validation consuming codes.

## Non-Goals
- No UI redesign.
- No Firestore rule changes.
- No refactor of unrelated auth/invite flows.
