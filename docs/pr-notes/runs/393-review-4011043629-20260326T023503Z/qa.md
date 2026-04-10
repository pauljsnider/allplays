# QA

- Primary regression target: email/password login on `login.html` with and without invite redemption state.
- Secondary checks: Google redirect path still composes through the coordinator; no residual direct `getPostAuthRedirect` references remain.
- Evidence to collect: search results, targeted unit tests for coordinator module, and branch diff.
