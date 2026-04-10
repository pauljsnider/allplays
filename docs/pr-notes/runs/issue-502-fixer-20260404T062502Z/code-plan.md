Thinking level: medium
Reason: narrow issue, but the failure can hide in page/module integration rather than a single pure function.

Plan:
1. Add a smoke spec against the real `login.html` using mocked `auth.js`, `db.js`, and `utils.js`.
2. Run the new spec first to determine whether there is an actual regression.
3. If red, patch the minimal redirect wiring responsible for the wrong destination.
4. Re-run focused browser and unit tests, then commit with issue reference.
