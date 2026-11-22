# Architecture analysis

Root cause: the Firestore trigger impersonates the invite issuer with an auth context whose token is empty. hasTeamAdminAccess intentionally authorizes adminEmails entries only from the trusted Auth token email, so owner UID authorization succeeds while email-only co-admin authorization fails.

The trigger core should resolve the issuer through Firebase Admin Auth before calling the existing auto-link handler, then build the same narrow auth context the callable expects: issuer UID plus authoritative Auth email. The Functions entry point supplies admin.auth().getUser; authorization remains centralized in the existing auto-link handler and hasTeamAdminAccess.

Do not recover the issuer email from the mutable Firestore user profile. Keep the existing warning-and-deliver fallback when Auth lookup or auto-linking fails.

The requested allplays-architecture-expert skill and role subagent were unavailable in this runtime. This artifact records the main-lane Firebase architecture synthesis.
