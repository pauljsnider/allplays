Objective: make admin invite signup attach the new account to the invited team before the code is consumed.

Current state: existing-account admin acceptance has an atomic team-link path, but new-account signup depends on cache-busted auth modules and can run stale signup logic in the browser.
Proposed state: the signup route loads fresh admin-invite redemption code and cannot serve stale generic code consumption after deployment.

Risk surface and blast radius:
- Auth/signup only.
- Multi-tenant access control is involved because the failure drops the team-admin grant while still consuming the invite.
- Safer than broad refactoring because the change is limited to module version invalidation plus regression coverage.

Assumptions:
- Production clients can hold cached `auth.js` / `signup-flow.js` modules across deploys.
- The stale module path matches the reported behavior: code redeemed without team admin linkage.
- Existing source already contains the intended admin invite redemption behavior.

Recommendation:
- Bump the cache-busted imports for `auth.js`, `signup-flow.js`, and `admin-invite.js`.
- Add a regression test that fails if future signup-flow changes do not invalidate the browser cache chain.

Success measure:
- New deploys force browsers onto the current admin-invite signup logic.
- Admin invite signup no longer strands new users without team access.
