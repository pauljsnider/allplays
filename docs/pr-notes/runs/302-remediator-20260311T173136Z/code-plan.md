Skill fallback note: `allplays-orchestrator-playbook` and role subagent spawning were requested but are unavailable in this session, so this run uses inline role analysis with persisted notes.

Implementation steps:
1. Move `addTeamAdminEmail()` in `inviteExistingTeamAdmin()` behind successful invite validation.
2. Preserve current behavior for:
   - existing users: persist immediately, no email send
   - valid codes: persist before email send, fallback to shareable code if email delivery fails
3. Add regression coverage for malformed or missing-code invite responses to prove fail-closed behavior.
