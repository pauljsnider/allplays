# Current-State Read

`createTeamFeeBatch` allocates a Firestore `WriteBatch`, writes one batch document, then schedules one write per raw recipient. Blank IDs are skipped too late, duplicate IDs schedule duplicate operations, and 500 distinct recipients produce 501 writes. Both clients forward unbounded rosters.

# Proposed Design

Add a pure shared module exporting the 499 limit, stable actionable error, canonical ID normalization, deterministic deduplication, and count assertion. Enforce it in `createTeamFeeBatch` before any Firestore allocation, in the React service before delegation, and in legacy draft normalization. Keep the persistence guard authoritative and retain the first normalized record.

# Files And Modules Touched

- `js/team-fee-batch-limits.js`
- `js/db.js`
- `js/team-fees-admin.js`
- `apps/app/src/lib/adapters/legacyTeamFees.ts`
- `apps/app/src/lib/teamFeesService.ts`
- Focused DB, legacy, app-service, and React component tests
- Full cache-bust importer cohort required by `js/db.js`

# Data/State Impacts

No schema migration. `recipientCount` becomes the distinct normalized valid count. Accepted requests remain atomic. Rejected oversized requests allocate no batch and perform no writes.

# Security/Permissions Impacts

No authorization or Firestore Rules changes. Existing administration checks remain intact. The guard reduces operational blast radius while retaining the current atomicity boundary.

# Failure Modes And Mitigations

- Reject 500+ recipients before `collection`, `doc`, `writeBatch`, timestamp, or commit.
- Normalize whitespace variants, remove blanks, and deduplicate before counting.
- Deduplicate duplicate active-roster rows in React.
- Preserve existing catch/finally paths so UI errors remain retryable.
- Lock the one metadata plus 499 recipient write budget in regression tests.
- Follow the transitive cache-bust chain until the guard passes.
