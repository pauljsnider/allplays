# Code plan synthesis (fallback single-agent)

Requested subagent skill `allplays-code-expert` was not available in local skills list.

## Plan
1. Add `js/edit-team-admin-invites.js` helper with async orchestration for post-create invite processing.
2. Add failing unit tests in `tests/unit/edit-team-admin-invites.test.js` that assert pending invites are processed.
3. Update `edit-team.html`:
   - maintain `pendingAdminInviteEmails` for new-team flow
   - queue emails on Send Invite when no team exists
   - after `createTeam()`, process pending invites via helper
   - show warning if fallback/manual sharing is required
4. Run targeted tests and adjust until green.
5. Commit with issue reference.
