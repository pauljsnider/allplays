# Code Plan

1. Inspect `js/parent-dashboard-fees.js` for `getFirstDefined`, `getFeeLineItems`, and `getFeeInstallments`.
2. Add a minimal helper that returns the first array candidate with length > 0, otherwise `[]`.
3. Replace only the two collection alias resolvers to use the new helper.
4. Run lightweight validation and commit the source plus role notes.
