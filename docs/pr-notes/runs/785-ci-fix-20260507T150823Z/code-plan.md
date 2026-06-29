# Code plan

1. Locate imports of `js/db.js` used by the homepage functions changed in this PR.
2. Update `index.html` from `./js/db.js?v=76` to `./js/db.js?v=76`.
3. Do not change unrelated imports or refactor code.
4. Run the cache-bust guard and targeted unit test, then commit.
