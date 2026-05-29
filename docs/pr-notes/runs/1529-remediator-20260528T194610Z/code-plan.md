# Code Plan

- Extend FeeRecipientData with server-compatible balance/paid amount fields.
- Add getFeeBalanceCents helper and require balanceCents > 0 in canPayOnline.
- Update team-fees component spec with a regression test that fails before the eligibility change.
- Commit only scoped remediation files plus role notes.
