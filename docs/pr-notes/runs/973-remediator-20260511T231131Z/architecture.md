# Architecture Decisions

- Enforce field allowlists at the database boundary in `js/db.js`, closest to Firestore writes, so callers cannot inject arbitrary document fields.
- Preserve server-controlled fields by setting `scope`, `createdAt`, and `updatedAt` after selecting allowed user fields.
- Guard venue-control form submission in `organization-schedule.html` using current access state before building and writing payloads.
- Disable venue-control inputs when general schedule initialization is blocked to keep UI state consistent with authorization state.

## Risks And Rollback
- Risk: omitted legitimate fields could hide intended data. Mitigation: allowlist includes the fields emitted by existing payload builders.
- Rollback: revert this remediation commit if schedule control writes regress.
