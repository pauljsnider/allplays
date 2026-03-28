Thinking level: medium
Reason: HTML-inline workflow extraction plus custom DOM harness, but narrow scope and low architectural ambiguity.

Implementation plan:
1. Add `js/homepage.js` with dependency-injected helpers mirroring current homepage behavior.
2. Replace the inline homepage logic in `index.html` with a thin bootstrap call into the new module.
3. Add `tests/unit/homepage-index.test.js` using a lightweight mock DOM environment.
4. Run the targeted unit tests, then the full unit suite if time allows, and commit the focused patch.
