Thinking level: medium
Reason: small blast radius, but the issue text and branch reality differ on harness and file layout.

Plan:
1. Add `js/parent-dashboard-rsvp-controls.js` with a small controller factory for submit and button-click behavior.
2. Replace the inline RSVP handlers in `parent-dashboard.html` with the imported controller.
3. Add `tests/unit/parent-dashboard-rsvp-controls.test.js` covering grouped-row and per-child behavior plus page wiring assertions.
4. Run focused Vitest validation:
   - `node ./node_modules/vitest/vitest.mjs run tests/unit/parent-dashboard-rsvp-controls.test.js tests/unit/parent-dashboard-rsvp.test.js`
5. Stage and commit all changes with an issue-referencing message.
