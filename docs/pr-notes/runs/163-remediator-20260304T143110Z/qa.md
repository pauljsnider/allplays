# QA role notes

- Test focus for this remediation:
  - Biweekly multi-day cadence remains anchored correctly after fast-forward.
  - Long-running weekly series returns a complete contiguous set of occurrences in-window.
  - No early truncation from iteration guard.
- Validation plan:
  - Run `tests/unit/recurrence-expand.test.js` with Vitest.
  - Confirm long-running weekly test asserts exact expected list and count over window.
- Residual risk:
  - Broader recurrence scenarios (count-limited old series) are unchanged by this patch and should be covered separately if needed.
