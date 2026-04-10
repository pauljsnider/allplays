# QA

- Root cause evidence: the CI log reports `js/db.js changed without a matching db.js version bump in imports.`
- Scope evidence: PR #460 changes `getUpcomingLiveGames` in `js/db.js` and the homepage consumes that function via the direct `index.html` import.
- Validation plan: run `node scripts/check-critical-cache-bust.mjs` against the PR diff and confirm the check passes; inspect the diff to ensure only the cache-bust import and requested notes were added.
- Residual risk: there is no automated browser test for cache invalidation itself, so final end-to-end confirmation still relies on CI rerun behavior.
