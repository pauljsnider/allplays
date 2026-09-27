# Current-State Read

`listTeamFeeRecipients` performs one collection query plus one concurrent `getDoc` for every `hasAdminBilling === true` recipient. React maps only parent-safe fields, while legacy management consumes hydrated billing notes and payment references.

# Proposed Design

Add `listTeamFeeRecipients(teamId, batchId, { hydrateAdminBilling = true } = {})`. Return the sorted parent-safe documents before constructing private document references when the option is false. React passes `{ hydrateAdminBilling: false }`; legacy keeps its two-argument default.

# Files And Modules Touched

- `js/db.js`
- `apps/app/src/lib/teamFeesService.ts`
- Focused DB, service, component, and legacy smoke tests
- Versioned production consumers in the cache-bust dependency chain

# Data/State Impacts

No persisted data, indexes, rules, schemas, or writes change. React omits only enrichment it already discarded. Legacy hydration, sorting, and fail-soft reads remain unchanged.

# Security/Permissions Impacts

Authorization remains unchanged. The React path reduces unnecessary reads and exposure of private billing metadata. Legacy continues to hydrate only after its existing management authorization.

# Failure Modes And Mitigations

- Default regression: retain a two-argument hydration test.
- N+1 recurrence: assert zero `getDoc` calls for 100 flagged recipients.
- Mapping regression: assert balances, ledger, totals, and actions without billing metadata.
- Legacy regression: assert reconciliation note and online refund controls.
- Stale modules: advance the full transitive cache-bust cohort and run the guard.
- Rollback: remove the React option or revert the patch; no data migration is needed.
