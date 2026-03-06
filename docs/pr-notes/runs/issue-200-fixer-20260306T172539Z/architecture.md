Control playbook note: the requested `allplays-orchestrator-playbook` and role skills were not available in this session, so the role synthesis was performed directly and recorded here.

Architecture synthesis:
- Problem actually being solved: ensure deployed browsers execute the current admin-invite signup path, not a stale cached module.
- Evidence: `auth.js` delegates email/password signup into `signup-flow.js` via a versioned ES module import, and page entry points also import `auth.js` through versioned URLs.
- Constraint: this is a static site with no build pipeline, so cache invalidation is explicit and manual.

Recommended smallest change:
- Increase the `auth.js` consumer query string to invalidate cached auth code.
- Increase the `signup-flow.js` and `admin-invite.js` import query strings inside `auth.js` so nested module caches are invalidated too.

Blast radius comparison:
- Current state blast radius: invited admins can permanently lose a one-time code without team access.
- New state blast radius: a normal static-asset cache miss after deploy; no data model or security-rule changes.

Rollback:
- Revert the version string bumps if they cause unexpected loading behavior.
- No data rollback required because this patch does not mutate persisted data differently.
