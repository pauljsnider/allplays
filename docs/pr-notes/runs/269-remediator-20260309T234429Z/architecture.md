# Architecture analysis

- Current state: approval transaction mutates team membership and requester profile in one client-side transaction.
- Proposed state: approver transaction should update only team-owned docs; requester profile updates must occur through a path already allowed by rules or be skipped if they are only derived convenience data.
- Blast radius: keep changes scoped to parent approval flow and avoid changing global user-write authorization.
