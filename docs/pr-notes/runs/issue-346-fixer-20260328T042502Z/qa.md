Test strategy:
- Unit-test the homepage module with mocked DOM elements and injected auth/db/utils dependencies.
- Cover both anonymous and authenticated CTA states.
- Cover live rail merge behavior with a duplicate game returned by both live and upcoming queries.
- Cover replay card rendering and confirm replay URLs include `replay=true`.
- Cover partial failure where live query throws and upcoming still renders.
- Cover empty live/upcoming plus replay failure fallbacks, asserting exact copy replacement instead of lingering loading text.

Regression guardrails:
- Assert container HTML no longer contains loading placeholders after loaders finish.
- Assert only one duplicated game card is rendered.
- Assert error handling remains isolated per rail.

Validation command:
- `npm test -- tests/unit/homepage-index.test.js`
