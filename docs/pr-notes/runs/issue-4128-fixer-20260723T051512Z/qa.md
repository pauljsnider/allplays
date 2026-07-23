# Risk Matrix

- High: ambiguous rollback records or order can extend an outage.
- High: public-only validation can miss authentication failures.
- Medium: partial DNS propagation or incomplete TLS issuance can create regional
  failures.
- Medium: early meta CSP bridge removal can weaken browser controls.
- Low: App Check state can drift unless both documents repeat the
  **Unenforced** gate.

# Automated Tests To Add/Update

Add `tests/unit/hosting-cutover-runbook.test.js` using the existing
documentation-contract pattern. Assert DNS/TLS checks, mandatory public and
authenticated smoke, the GitHub Pages rollback target and ordered reversal,
App Check state, and the evidence threshold for meta CSP bridge removal.

# Manual Test Plan

Perform a tabletop review only. Confirm the runbook captures owners, exact DNS
records and TTLs, deployment identifiers, evidence location, validation order,
rollback order, and objective completion criteria.

# Negative Tests

- Block on stale or unexpected DNS, incomplete TLS, skipped smoke, or a
  cross-origin redirect.
- Block when any Firebase API is **Enforced**.
- Block when rollback records were not captured before the change.
- Retain the meta CSP bridge when production header, smoke, DNS, TLS, monitoring,
  or approval evidence is incomplete.

# Release Gates

- Focused documentation contract test passes.
- Existing candidate public and authenticated contract tests remain unchanged.
- No DNS, hosting, GitHub Pages, or App Check configuration changes are present.
- Full GitHub CI remains the merge gate.

# Post-Deploy Checks

Verify both Markdown documents render and link correctly. When the runbook is
later executed, retain timestamped DNS, TLS, smoke, commit/deployment, App Check,
monitoring, and operator approval evidence.
