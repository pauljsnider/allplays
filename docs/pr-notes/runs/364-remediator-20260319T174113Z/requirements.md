Objective: prevent `edit-team.html` from loading a stale cached `js/team-access.js` module after deploy.

Current state: `edit-team.html` imports `hasFullTeamAccess` and `normalizeAdminEmailList` from an unversioned `./js/team-access.js` URL while hosting caches `*.js` for 3600 seconds.

Proposed state: add an explicit version query to the `team-access.js` import in `edit-team.html` so the page requests the updated module immediately after deploy.

Risk surface and blast radius: limited to the Edit Team page module graph. No backend, auth, or Firestore behavior changes.

Assumptions:
- The review comment is accurate that `normalizeAdminEmailList` is a newly required named export for this page.
- Existing cache-busting convention in this repo is `?v=<number>` on HTML module imports.

Recommendation: version the `team-access.js` import in `edit-team.html` and avoid broader refactoring. This is the smallest change that removes the deploy-time stale-cache failure.
