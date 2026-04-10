# Code Plan

1. Add the required run notes for architecture, QA, and code plan under `docs/pr-notes/runs/460-ci-fix-20260402T040112Z/`.
2. Bump the `index.html` import of `./js/db.js` from `?v=15` to `?v=16` so the homepage loads the changed module.
3. Run the cache-bust guard locally, review the diff scope, then stage and commit the fix with the required commit message format.
