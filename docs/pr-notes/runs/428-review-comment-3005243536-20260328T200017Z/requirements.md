## Requirements Role Summary

- Objective: keep the `live-tracker` unit harness stable when cache-buster query strings change on module imports.
- Current state: the harness rewrites `live-tracker.js` imports before evaluating the module with `AsyncFunction`, but that rewrite path should not depend on exact `?v=` values.
- Proposed state: rewrite imports by module path, not by specific query version, so unrelated cache-buster bumps do not break tests.
- Risk surface: unit-test harness only. No production runtime behavior changes.
- Success criteria:
  - The harness still strips relevant imports when `./db.js`, `./firebase.js`, `./utils.js`, or `./auth.js` use different `?v=` values.
  - Existing opponent-stats regression coverage still passes.
- Assumption: the review concern is limited to harness brittleness, not application code behavior.
