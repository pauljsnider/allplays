# Patch Plan

- Add a shared 499-recipient limit/error/normalization module.
- Guard `createTeamFeeBatch` before Firestore allocation and persist normalized distinct recipients.
- Reuse the shared guard in legacy draft normalization and the React service.
- Re-export helpers through the existing app adapter boundary.
- Extend focused DB, legacy, service, and React tests.
- Update the complete transitive browser cache-bust cohort.

# Code Changes Applied

None by the role. The role was analysis-only.

# Validation Run

No commands run by the role. The main implementation must run focused Vitest suites and `check-critical-cache-bust.mjs`.

# Residual Risks

- Missing a transitive cache importer can leave older clients unsafe.
- Duplicate metadata needs deterministic first-record behavior.
- Future metadata writes must reduce the 499 maximum or reserve additional operations.

# Commit Message Draft

`Guard team fee recipient batch limit (#4648)`
