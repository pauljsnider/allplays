## Architecture Decisions

- Add a hard client-side maximum import limit of 500 rows per organization schedule CSV import.
- Enforce the limit before preview rendering to avoid building large DOM previews.
- Add a second defensive guard before the import write loop to avoid partial writes if state is stale or manipulated.
- Keep the change local to `organization-schedule.html`; no Firestore rules, schema, or shared module changes.

## Risk Surface And Blast Radius

- Positive impact: reduces browser resource exhaustion and Firestore write amplification from one import action.
- Blast radius is limited to organization schedule bulk import.
- Existing single matchup creation and team schedule flows are not touched.
- Residual risk: the browser still reads and parses uploaded CSV text before the row-count guard. A future hardening pass can add file-size or streaming parse controls if needed.

## Rollback

- Remove the row-limit constant and two guards.
- No data migration or Firestore rollback required because rejected imports create no documents.
