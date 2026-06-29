# Architecture note

Root cause: PR #785 changes `js/db.js` homepage live-game discovery logic, but no direct import of `db.js` changed its cache-bust query parameter in the branch diff. The cache-bust guard requires at least one matching `db.js?v=<n>` import update whenever `js/db.js` changes.

Decision: bump the homepage `index.html` import from `./js/db.js?v=76` to `./js/db.js?v=76` because the changed exports (`getUpcomingLiveGames`, `getLiveGamesNow`, `getRecentLiveTrackedGames`) are consumed there.

Risk and rollback: low risk, static import URL only. Roll back by reverting the version bump if the underlying `js/db.js` change is reverted.
