Thinking level: low
Reason: single-file test harness change with clear reviewer guidance.

Current state:
- The page under test is an HTML entry point that imports several ES modules.
- The smoke spec intercepts selected module requests with inline JavaScript stubs.

Proposed state:
- Extend the existing request interception set with `**/js/edit-config-access.js?v=1`.
- Stub `getEditConfigAccessDecision` to return an allowed decision and preserve the resolved team id.

Blast radius:
- Limited to the Playwright smoke environment for this one spec.
- No shared runtime modules or HTML files need modification.

What would change this plan:
- Evidence that the real module must be exercised in this smoke test instead of being isolated.
