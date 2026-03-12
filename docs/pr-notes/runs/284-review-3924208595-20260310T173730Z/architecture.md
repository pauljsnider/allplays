# Architecture role

- Current state: dashboard bootstrap hydrates profile metadata, then calls `getUserTeamsWithAccess(...)` during initial page load.
- Proposed state: preserve the existing data flow but make the team-access lookup key `user.email || profile?.email`.
- Why: auth state is the source of truth for the active identity; profile email is a resilience fallback for providers or load paths where `user.email` is temporarily missing.
- Blast radius comparison:
  - Reviewed commit: medium risk of false-negative team access when profile email is stale.
  - Current head: lower risk because fallback only activates on missing auth email.
- Controls: no new data access paths, no rules changes, no tenant-boundary expansion.
- Recommendation: no additional code restructuring. Keep the focused regression around the exact lookup string.
