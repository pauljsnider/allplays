# Architecture

- Objective: restore the `cache-bust-guard` check for PR #460.
- Current state: `js/db.js` changed in this PR, but `index.html` still imports `./js/db.js?v=15`, so the homepage can keep serving the cached pre-fix module.
- Proposed state: bump the homepage import to `./js/db.js?v=16` so the changed `getUpcomingLiveGames` logic is cache-busted where this PR uses it.
- Risk surface: limited to the homepage module import in `index.html`.
- Blast radius: low; no runtime logic changes beyond loading the updated `db.js` asset for the index page.
- Assumptions: the changed `db.js` behavior is only required for the homepage flow touched by this PR, and broader app-wide cache busting is unnecessary for this fix.
