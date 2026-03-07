# Requirements Role Summary

- Objective: remove executable injection paths from parent incentives earnings UI without changing payout behavior.
- Current state: breakdown text is already HTML-escaped before render; inline action handlers still interpolate dynamic identifiers directly.
- Proposed state: all dynamic string arguments emitted into inline handlers are escaped for JavaScript string context and HTML attribute context.
- Risk surface: parent incentives panel only; no data model or Firestore write semantics change.
- Blast radius: low, limited to rule actions, cap actions, stat pill selection, and mark-paid button rendering in `js/parent-incentives.js`.
- Acceptance criteria:
  - malicious stat keys continue to render as text, not HTML
  - malicious IDs cannot terminate inline handler string arguments
  - existing rule creation, toggle, delete, cap save/remove, and mark-paid actions preserve argument values
  - focused unit tests pass for both escaped breakdown rendering and escaped inline handlers
