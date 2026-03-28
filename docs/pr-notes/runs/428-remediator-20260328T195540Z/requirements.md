# Requirements synthesis

- Objective: harden the `live-tracker` unit harness so unrelated import cache-buster changes and real async timer ordering do not break or weaken opponent-stats regression coverage.
- Current state: the harness rewrites `live-tracker.js` imports with exact versioned string matches and executes `setTimeout` callbacks synchronously.
- Proposed state: import rewrites should match module specifiers without pinning exact query versions, and timer callbacks should run on a later microtask so timeout-backed flags behave like browser code.
- Blast radius: limited to `tests/unit/live-tracker-opponent-stats.test.js` and only affects test harness behavior for the `live-tracker` module.
- Assumptions:
  - The production `live-tracker.js` import list and timeout usage remain valid; the review feedback is about test fidelity, not runtime bugs.
  - Preserving async ordering in the harness is sufficient for the current opponent deletion regression test.
- Recommendation: patch only the harness helpers, keep the production code unchanged, and validate with the affected unit file.
- Success measure: the test keeps passing after the patch, remains resilient to import query version churn, and no timeout-backed flag stays spuriously truthy because of synchronous mock ordering.
