# QA synthesis

- Primary regressions to guard:
  - `live-tracker.js` import query bumps should not break the `AsyncFunction` harness.
  - Opponent deletion should still schedule persisted writes correctly when timeout callbacks run asynchronously.
- Test shape:
  - Keep the existing hydration assertions.
  - Preserve the interaction test around `renderOpponents()` delete wiring while flushing the queued timeout callbacks explicitly.
- Why this is sufficient:
  - The review items target harness fragility and timer fidelity, both fully exercised by the existing source-backed module boot path in this test file.
- Validation target:
  - `npm test -- tests/unit/live-tracker-opponent-stats.test.js`
  - Fall back to `npm run test:unit -- tests/unit/live-tracker-opponent-stats.test.js` only if argument forwarding differs in this repo.
