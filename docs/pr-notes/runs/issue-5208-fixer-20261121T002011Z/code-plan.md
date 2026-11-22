# Code plan

1. Extend the invite-email trigger factory with an authoritative issuer Auth lookup dependency.
2. For parent invites with an issuer UID, resolve the issuer and pass the auto-link handler a context containing that UID and the Auth record email.
3. Wire the production trigger to admin.auth().getUser.
4. Add the focused co-admin trigger integration regression to the existing parent auto-link callable test harness.
5. Run only the focused trigger and parent auto-link Function tests, then inspect the diff and commit all fix, test, and run-artifact files together.

Conflict resolution: preserve fallback email delivery on lookup/auto-link failure while making the linked outcome deterministic when the authoritative co-admin identity is available. Avoid changing the shared authorization helper or trusting Firestore profile email, which would broaden the security surface.

The requested allplays-code-expert and allplays-orchestrator-playbook skills and all role subagents were unavailable in this runtime. This artifact records the main-lane implementation synthesis.
