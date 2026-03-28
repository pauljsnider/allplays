Objective: isolate homepage discovery behavior behind a thin module boundary without changing product behavior.

Current state:
- `index.html` inline module imports auth, utils, and db functions directly, then mutates DOM.

Proposed state:
- `js/homepage.js` exports `initHomepage` plus focused helpers for CTA, live rail, and replay rail rendering.
- `index.html` becomes a thin bootstrap that imports dependencies and calls `initHomepage`.

Blast radius comparison:
- Current: logic is trapped in inline HTML and difficult to validate, so regressions escape silently.
- New: same runtime dependencies and DOM targets, but behavior is covered by unit tests with no backend or routing changes.

Control equivalence:
- Auth still drives CTA through `checkAuth`.
- Firestore query functions are unchanged.
- Rendered hrefs, fallback messages, and dedupe semantics remain identical.

Rollback plan:
- Revert `js/homepage.js`, restore the previous inline module in `index.html`, remove the new tests.
