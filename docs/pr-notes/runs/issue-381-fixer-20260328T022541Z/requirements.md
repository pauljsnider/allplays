Objective: prove the platform-admin contract for the Edit Configs stats workflow and prevent regressions.

Current state:
- Shared access helpers and banner navigation already treat `user.isAdmin === true` as full team access.
- `edit-config.html` is part of a live admin workflow reached from `edit-schedule.html`.
- Existing coverage proves helper semantics, but not the page workflow a platform admin actually uses.

Proposed state:
- Add explicit coverage that a platform admin can open `edit-config.html#teamId=...`, see the banner and existing configs, create a config, and delete it without redirect.

Risk surface and blast radius:
- Access-control regressions on admin pages can silently block platform admins from team operations.
- Blast radius is limited to the stats config workflow, but it breaks a reachable admin path from schedule management.

Assumptions:
- Platform admins are intended to have equivalent or stronger access than team owners/admins for this workflow.
- Smoke coverage with module stubs is acceptable in this repo as the nearest existing page-level automation.

Recommendation:
- Add page-level regression coverage for the platform-admin journey and keep the code change narrow to runtime hardening around the shared access helper import.
