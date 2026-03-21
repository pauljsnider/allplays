Objective: preserve module compatibility across deploys where HTML and JS assets may update at different times in the browser cache.

Current state: the page HTML can update immediately while `team-access.js` remains cached for up to one hour, creating a module export mismatch and breaking page initialization.

Proposed state: `edit-team.html` references `./js/team-access.js?v=1`, forcing a new module URL when this page depends on updated exports.

Blast radius comparison:
- Before: deploy could break all Edit Team loads for users holding the old module in cache.
- After: only users requesting the new page fetch the new module URL; stale module reuse is avoided for this dependency.

Controls: aligned with the repo’s existing cache-busting pattern on other page imports. Rollback is trivial by reverting one import line.
