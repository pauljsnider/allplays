# Current-State Read
`tests/unit/recurrence-expand.test.js` includes a long-running weekly test with a static expected list. It proves some dates exist but weakly communicates completeness across the entire recurrence window.

# Proposed Design
Strengthen only the test by deriving expected in-window Monday occurrences from `windowStart` and `windowEnd`, then assert:
- exact equality of returned date list,
- exact expected count,
- no internal gaps via 7-day interval checks.

# Files And Modules Touched
- `tests/unit/recurrence-expand.test.js`

# Data/State Impacts
- Test-only change; no production data paths.
- No runtime state changes.

# Security/Permissions Impacts
- None. No auth/rules/network surface changes.

# Failure Modes And Mitigations
- Risk: Test mirrors implementation too closely.
  Mitigation: Build expected dates from independent window arithmetic and invariant cadence checks.
- Risk: Timezone drift in expectations.
  Mitigation: Use fixed UTC timestamps and `instanceDate` string assertions.
