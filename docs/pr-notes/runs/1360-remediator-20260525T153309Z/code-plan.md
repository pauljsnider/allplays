# Code Plan

- Sanitize and preserve team media upload grant arrays in `js/auth.js` during `checkAuth` profile hydration.
- Add a direct legacy hydration regression test covering canonical and legacy grant fields.
- Add app auth static parity coverage for `AuthUser` fields and `toAuthUser` string filtering.
- Update stale team media auth cache-bust test expectations from v14 to v15.
- Commit the targeted remediation only on the current branch.
