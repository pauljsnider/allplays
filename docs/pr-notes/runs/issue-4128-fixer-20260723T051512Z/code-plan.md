# Acceptance Criteria

- Candidate DNS/TLS validation is objective and reproducible.
- Public and authenticated candidate smoke must pass before cutover.
- App Check remains **Unenforced** throughout candidate validation.
- GitHub Pages is the named rollback target with exact saved DNS values and an
  ordered reversal procedure.
- Meta CSP bridge removal requires retained DNS, TLS, header, smoke, monitoring,
  and approval evidence.

# Architecture Decisions

- Add documentation and a focused contract test only.
- Treat the pre-cutover DNS provider export as authoritative. Current GitHub
  Pages values are useful context but not a substitute for that export.
- Keep the meta CSP bridge and GitHub Pages unchanged in this slice.

# QA Plan

Add a Vitest documentation contract, prove it fails before the runbook exists,
then run only that focused test after implementation.

# Implementation Plan

1. Add `tests/unit/hosting-cutover-runbook.test.js`.
2. Confirm the focused test fails because the runbook is absent.
3. Add `docs/hosting-cutover-runbook.md`.
4. Cross-reference it from `docs/firebase-app-check-rollout.md`.
5. Run the focused test and inspect the final diff.

# Risks And Rollback

The patch changes documentation and its regression contract only. Revert the
single commit if the operational guidance is incorrect. The requirements and
architecture roles differed on hard-coding GitHub Pages IPs; the synthesis uses
the safer direction: identify currently observed values as context, but require
the verified pre-cutover provider export as the exact rollback source of truth.

# Patch Plan

Keep the runbook operator-focused, use commands already present in the
repository, and avoid provider-specific mutation commands that cannot be
verified from repository context.

# Code Changes Applied

- Added the hosting cutover and rollback runbook.
- Added the App Check rollout cross-reference and **Unenforced** reminder.
- Added a focused documentation contract test.

# Validation Run

Passed:
`npx vitest run tests/unit/hosting-cutover-runbook.test.js --reporter=verbose`
(5 tests).

# Residual Risks

Authenticated smoke requires protected CI or operator credentials and is an
execution-time gate, not a local unit-test prerequisite.

# Commit Message Draft

`Document hosting cutover rollback runbook (#4128)`
