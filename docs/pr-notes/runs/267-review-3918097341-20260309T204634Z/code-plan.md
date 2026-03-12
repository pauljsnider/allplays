Thinking level: low
Reason: the branch already contains the runtime remediation; remaining work is a focused regression guard and validation.

Plan
1. Verify PR head versus reviewed commit and confirm the runtime fix exists in `team-chat.html`.
2. Add a focused unit test that locks the cleanup contract:
   - cleanup helper import is present
   - uploads are sequential
   - catch block deletes already-uploaded attachments
3. Run targeted tests for team chat media and cleanup wiring.
4. Commit and push the regression coverage to the active PR branch.
