# Patch Plan

- Add a default-on `hydrateAdminBilling` loader option.
- Return sorted parent-safe recipients before private reads when disabled.
- Pass the disabled option only from React management.
- Add constant-read, mapping, large-UI, and legacy regressions.
- Advance every direct and transitive production cache key required by `js/db.js`.

# Code Changes Applied

Planned only at role-analysis time. The main lane owns all implementation edits.

# Validation Run

Planned focused unit, app component, legacy smoke, and cache-bust guard commands. No role agent ran validation.

# Residual Risks

- Incomplete cache-bust propagation could serve mixed module versions.
- Component mocks cannot prove Firestore counts, so the DB unit test owns that invariant.
- Legacy smoke proves metadata consumption; the default-loader test proves the private read.

# Commit Message Draft

`Optimize React team fee recipient loading (#4586)`
