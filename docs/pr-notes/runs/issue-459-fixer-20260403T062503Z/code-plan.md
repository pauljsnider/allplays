Thinking level: low
Reason: small, localized footer wiring change with existing tests nearby.

Implementation plan:
1. Update unit and smoke expectations so `Contact` must be a direct support `mailto:` workflow.
2. Run targeted tests to confirm the new expectation fails against current code.
3. Patch `index.html` and `js/utils.js` footer contact links.
4. Re-run targeted tests.
5. Commit the docs, tests, and production change together.
